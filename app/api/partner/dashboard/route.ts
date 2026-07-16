import { NextRequest, NextResponse } from "next/server";
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

// Cálculo puro FIFO: nunca escribe nada de vuelta a la base de datos (el
// GET handler decide aparte si hay que persistir una transición a
// "completado", ver más abajo).
//
// Asignación por CLP (igual a como el usuario ya lleva sus capacity a mano):
// cada venta cubre CLP de la capacity activa más antigua (por createdAt) que
// todavía tenga saldo pendiente, en orden — cuando una capacity llega a
// cubrir el 100% de su capacityClp, la siguiente venta pasa a cubrir la
// próxima capacity. El USDT/comisión de cada venta se prorratea según qué
// fracción de su CLP quedó cubierta por cada capacity, para poder calcular
// el costo real (USDT cubierto × tasa de compra de esa capacity).
function computeFifo(capacities: any[], sales: any[]) {
  const orderedCapacities = [...capacities].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const clpRemaining = new Map<string, number>();
  for (const c of orderedCapacities) clpRemaining.set(c.id, Number(c.capacityClp));

  const orderedSales = [...sales].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime()
  );

  let totalUsdtSold = 0;
  let totalCommissionUsdt = 0;
  let totalUsdtDrawn = 0; // amount + commission: lo que realmente sale de la capacity/wallet
  let totalClpReceived = 0;
  let totalCostClp = 0;
  let matchedClp = 0;
  let matchedUsdtDrawn = 0;
  let unmatchedClp = 0;
  let unmatchedUsdt = 0;

  const usdtConsumedByCapacity = new Map<string, number>();
  const clpCoveredByCapacity = new Map<string, number>();

  for (const s of orderedSales) {
    const commission = Number(s.commission || 0);
    const usdtDrawnTotal = Number(s.amount) + commission; // USDT real que sale de la capacity/wallet
    const clpTotal = Number(s.totalPrice);
    totalUsdtSold += Number(s.amount);
    totalCommissionUsdt += commission;
    totalUsdtDrawn += usdtDrawnTotal;
    totalClpReceived += clpTotal;

    let clpToAllocate = clpTotal;
    for (const c of orderedCapacities) {
      if (clpToAllocate <= 0) break;
      const avail = clpRemaining.get(c.id) || 0;
      if (avail <= 0) continue;
      const takeClp = Math.min(avail, clpToAllocate);
      const ratio = clpTotal > 0 ? takeClp / clpTotal : 0;
      const takeUsdt = usdtDrawnTotal * ratio;

      clpRemaining.set(c.id, avail - takeClp);
      clpCoveredByCapacity.set(c.id, (clpCoveredByCapacity.get(c.id) || 0) + takeClp);
      usdtConsumedByCapacity.set(c.id, (usdtConsumedByCapacity.get(c.id) || 0) + takeUsdt);

      totalCostClp += takeUsdt * Number(c.buyPrice);
      matchedClp += takeClp;
      matchedUsdtDrawn += takeUsdt;
      clpToAllocate -= takeClp;
    }
    if (clpToAllocate > 0) {
      unmatchedClp += clpToAllocate;
      unmatchedUsdt += clpTotal > 0 ? usdtDrawnTotal * (clpToAllocate / clpTotal) : 0;
    }
  }

  // Ganancia solo se puede afirmar con exactitud sobre la porción con costo conocido.
  const realProfitClp = matchedClp > 0 ? matchedClp - totalCostClp : null;
  const profitPct = totalCostClp > 0 && realProfitClp !== null ? (realProfitClp / totalCostClp) * 100 : null;

  const avgSalePrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : null;
  const weightedAvgBuyPrice = matchedUsdtDrawn > 0 ? totalCostClp / matchedUsdtDrawn : null;

  const CLP_EPSILON = 1; // el CLP no usa decimales — menos de $1 pendiente cuenta como cubierto

  const perCapacityBreakdown = orderedCapacities.map((c) => {
    const capacityClp = Number(c.capacityClp);
    const clpCovered = clpCoveredByCapacity.get(c.id) || 0;
    const clpPending = Math.max(capacityClp - clpCovered, 0);
    const usdtConsumed = usdtConsumedByCapacity.get(c.id) || 0;
    const usdtAmount = Number(c.usdtAmount);
    return {
      id: c.id,
      provider: c.provider,
      date: c.date,
      status: c.status,
      buyPrice: Number(c.buyPrice),
      capacityClp,
      usdtAmount,
      clpCovered,
      clpPending,
      usdtConsumed,
      usdtRemaining: Math.max(usdtAmount - usdtConsumed, 0),
      costClp: usdtConsumed * Number(c.buyPrice),
      isCompleted: clpPending <= CLP_EPSILON,
    };
  });

  return {
    totalUsdtSold,
    totalCommissionUsdt,
    totalUsdtDrawn,
    totalClpReceived,
    avgSalePrice,
    weightedAvgBuyPrice,
    totalCostClp: matchedClp > 0 ? totalCostClp : null,
    profitClp: realProfitClp,
    profitPct,
    matchedClp,
    matchedUsdtDrawn,
    unmatchedClp,
    unmatchedUsdt,
    perCapacityBreakdown,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // Fecha del día a mostrar en la tabla de ventas (no afecta las estadísticas
  // globales, que siempre son de todo el historial sincronizado).
  const dateParam = searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

  const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);

  const [account, capacities, allSales] = await Promise.all([
    prisma.partnerAccount.findUnique({ where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } } }),
    prisma.partnerCapacity.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerSale.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
  ]);

  // Las ventas anteriores a trackingStartDate se ignoran en TODO el cálculo
  // (estadísticas y tabla) — quedan guardadas en la base de datos por si
  // sirven de referencia después, pero no cuentan para "la cuenta arrancada
  // desde hoy" que pidió el usuario.
  const trackingStart = account?.trackingStartDate ?? null;
  const sales = trackingStart ? allSales.filter((s) => s.executedAt >= trackingStart) : allSales;

  const stats = computeFifo(capacities, sales);

  // Transición automática a "completado": si una capacity quedó con su
  // capacityClp 100% cubierto y todavía figuraba "active", se pasa a
  // "finished" — una sola escritura, idempotente (no cambia nada si se
  // vuelve a calcular). No hay doble fuente de verdad: siempre se recalcula
  // desde las mismas filas de Neon, nunca desde un caché del cliente.
  const newlyCompleted = stats.perCapacityBreakdown.filter(
    (c) => c.isCompleted && c.status === "active"
  );
  if (newlyCompleted.length > 0) {
    await prisma.partnerCapacity.updateMany({
      where: { id: { in: newlyCompleted.map((c) => c.id) }, tenantId: session.tenantId, label: LABEL },
      data: { status: "finished", finishedAt: new Date() },
    });
    for (const c of stats.perCapacityBreakdown) {
      if (newlyCompleted.some((n) => n.id === c.id)) c.status = "finished";
    }
  }

  const salesForDate = sales
    .filter((s) => s.executedAt >= dayStart && s.executedAt <= dayEnd)
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());

  const totalPages = Math.max(1, Math.ceil(salesForDate.length / limit));
  const pageSafe = Math.min(page, totalPages);
  const pageSales = salesForDate.slice((pageSafe - 1) * limit, pageSafe * limit);

  return NextResponse.json({
    ok: true,
    stats,
    salesCount: sales.length,
    capacitiesCount: capacities.length,
    trackingStartDate: trackingStart ? trackingStart.toISOString().slice(0, 10) : null,
    date: dateParam,
    page: pageSafe,
    totalPages,
    salesForDateCount: salesForDate.length,
    recentSales: pageSales.map((s) => ({
      orderNumber: s.orderNumber,
      amount: Number(s.amount),
      totalPrice: Number(s.totalPrice),
      unitPrice: Number(s.unitPrice),
      commission: s.commission !== null ? Number(s.commission) : 0,
      executedAt: s.executedAt.toISOString(),
    })),
  });
}
