import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Cálculo puro FIFO: nunca escribe nada de vuelta a la base de datos.
// Cada venta consume USDT de la capacity activa/finished más antigua (por
// createdAt) que todavía tenga saldo, en orden. El status active/finished de
// una capacity es solo un marcador manual del usuario — no excluye la
// capacity del cálculo de costo, porque igual representa USDT real comprado
// que puede haber sido vendido.
function computeFifo(capacities: any[], sales: any[]) {
  const orderedCapacities = [...capacities].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const remaining = new Map<string, number>();
  for (const c of orderedCapacities) remaining.set(c.id, Number(c.usdtAmount));

  const orderedSales = [...sales].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime()
  );

  let totalUsdtSold = 0;
  let totalCommissionUsdt = 0;
  let totalUsdtDrawn = 0; // amount + commission: lo que realmente sale de la capacity/wallet
  let totalClpReceived = 0;
  let totalCostClp = 0;
  let matchedUsdtDrawn = 0;
  let unmatchedUsdt = 0;

  for (const s of orderedSales) {
    const commission = Number(s.commission || 0);
    // Binance cobra la comisión en USDT ADEMÁS del monto vendido — el USDT que
    // realmente sale de la capacity/wallet en cada venta es amount + commission,
    // no solo amount. Sin esto, el saldo de capacity no cuadra con la realidad.
    let usdtToAllocate = Number(s.amount) + commission;
    totalUsdtSold += Number(s.amount);
    totalCommissionUsdt += commission;
    totalUsdtDrawn += usdtToAllocate;
    totalClpReceived += Number(s.totalPrice);

    for (const c of orderedCapacities) {
      if (usdtToAllocate <= 0) break;
      const avail = remaining.get(c.id) || 0;
      if (avail <= 0) continue;
      const take = Math.min(avail, usdtToAllocate);
      remaining.set(c.id, avail - take);
      totalCostClp += take * Number(c.buyPrice);
      matchedUsdtDrawn += take;
      usdtToAllocate -= take;
    }
    if (usdtToAllocate > 0) unmatchedUsdt += usdtToAllocate;
  }

  // Ganancia solo se puede afirmar con exactitud sobre la porción con costo conocido.
  const knownCostRatio = totalUsdtDrawn > 0 ? matchedUsdtDrawn / totalUsdtDrawn : 0;
  const clpFromMatched = totalUsdtDrawn > 0 ? totalClpReceived * knownCostRatio : 0;
  const realProfitClp = matchedUsdtDrawn > 0 ? clpFromMatched - totalCostClp : null;
  const profitPct = totalCostClp > 0 && realProfitClp !== null ? (realProfitClp / totalCostClp) * 100 : null;

  const avgSalePrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : null;
  const weightedAvgBuyPrice = matchedUsdtDrawn > 0 ? totalCostClp / matchedUsdtDrawn : null;

  const perCapacityBreakdown = orderedCapacities.map((c) => {
    const usdtAmount = Number(c.usdtAmount);
    const usdtRemaining = remaining.get(c.id) || 0;
    const usdtConsumed = usdtAmount - usdtRemaining;
    return {
      id: c.id,
      provider: c.provider,
      date: c.date,
      status: c.status,
      buyPrice: Number(c.buyPrice),
      usdtAmount,
      usdtConsumed,
      usdtRemaining,
      costClp: usdtConsumed * Number(c.buyPrice),
    };
  });

  return {
    totalUsdtSold,
    totalCommissionUsdt,
    totalUsdtDrawn,
    totalClpReceived,
    avgSalePrice,
    weightedAvgBuyPrice,
    totalCostClp: matchedUsdtDrawn > 0 ? totalCostClp : null,
    profitClp: realProfitClp,
    profitPct,
    matchedUsdtDrawn,
    unmatchedUsdt,
    perCapacityBreakdown,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const [capacities, sales] = await Promise.all([
    prisma.partnerCapacity.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerSale.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
  ]);

  const stats = computeFifo(capacities, sales);

  return NextResponse.json({
    ok: true,
    stats,
    salesCount: sales.length,
    capacitiesCount: capacities.length,
    recentSales: [...sales]
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
      .slice(0, 30)
      .map((s) => ({
        orderNumber: s.orderNumber,
        amount: Number(s.amount),
        totalPrice: Number(s.totalPrice),
        unitPrice: Number(s.unitPrice),
        commission: s.commission !== null ? Number(s.commission) : 0,
        executedAt: s.executedAt.toISOString(),
      })),
  });
}
