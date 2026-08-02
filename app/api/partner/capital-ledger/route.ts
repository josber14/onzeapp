import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeFifo, aggregateRange } from "@/lib/partner-fifo";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Historial de "cierres" de período -- pedido explícito del usuario (jul
// 2026): si en un mes ni Hector ni Josber retiran toda la ganancia neta, lo
// que sobra se suma al capital inicial, con referencia de fecha y de cuál
// era el capital antes/después. Ver /api/partner/withdrawals para el
// registro de retiros que alimenta este cálculo.
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const entries = await prisma.partnerCapitalLedger.findMany({
    where: { tenantId, label: LABEL },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    ok: true,
    entries: entries.map((e) => ({
      id: e.id,
      periodFrom: e.periodFrom.toISOString().slice(0, 10),
      periodTo: e.periodTo.toISOString().slice(0, 10),
      netProfitUsdt: Number(e.netProfitUsdt),
      totalWithdrawnUsdt: Number(e.totalWithdrawnUsdt),
      addedUsdt: Number(e.addedUsdt),
      previousCapitalUsdt: Number(e.previousCapitalUsdt),
      newCapitalUsdt: Number(e.newCapitalUsdt),
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json().catch(() => ({}));
  const periodFromStr = String(body?.periodFrom || "");
  const periodToStr = String(body?.periodTo || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(periodToStr)) {
    return NextResponse.json({ ok: false, error: "Rango de fechas inválido" }, { status: 400 });
  }

  const [account, capacities, allSales, manualPayments, withdrawals] = await Promise.all([
    prisma.partnerAccount.findUnique({ where: { tenantId_label: { tenantId, label: LABEL } } }),
    prisma.partnerCapacity.findMany({ where: { tenantId, label: LABEL } }),
    prisma.partnerSale.findMany({ where: { tenantId, label: LABEL } }),
    prisma.partnerCapacityPayment.findMany({ where: { capacity: { tenantId, label: LABEL } } }),
    prisma.partnerWithdrawal.findMany({
      where: {
        tenantId,
        label: LABEL,
        withdrawnAt: { gte: new Date(periodFromStr + "T00:00:00.000Z"), lte: new Date(periodToStr + "T23:59:59.999Z") },
      },
    }),
  ]);

  if (!account) {
    return NextResponse.json({ ok: false, error: "Primero conecta la cuenta del socio" }, { status: 400 });
  }
  if (account.ppmPct === null || account.ppmPct === undefined) {
    return NextResponse.json({ ok: false, error: "Configura primero el % de PPM" }, { status: 400 });
  }

  const trackingStart = account.trackingStartDate ?? null;
  const sales = trackingStart ? allSales.filter((s) => s.executedAt >= trackingStart) : allSales;

  const manualPaymentsByCapacity = new Map<string, number>();
  for (const p of manualPayments) {
    manualPaymentsByCapacity.set(p.capacityId, (manualPaymentsByCapacity.get(p.capacityId) || 0) + Number(p.amountClp));
  }
  const stats = computeFifo(capacities, sales, manualPaymentsByCapacity);
  const range = aggregateRange(stats.saleBreakdown, periodFromStr, periodToStr);

  const pct = Number(account.ppmPct);
  const totalClpReceived = range.totalClpReceived;
  const profitClp = range.profitClp ?? 0;
  const avgSell = range.avgSalePrice ?? 0;
  const ppmClp = totalClpReceived * (pct / 100);
  const netoClp = profitClp - ppmClp;
  const netProfitUsdt = avgSell > 0 ? netoClp / avgSell : 0;

  const totalWithdrawnUsdt = withdrawals.reduce((sum, w) => sum + Number(w.amountUsdt), 0);
  const addedUsdt = netProfitUsdt - totalWithdrawnUsdt;

  // Pedido explícito del usuario: si se retiró más de lo que había de
  // ganancia neta, se bloquea -- nunca se resta capital por error acá.
  if (addedUsdt < 0) {
    return NextResponse.json({
      ok: false,
      error: `Se retiraron ${totalWithdrawnUsdt.toFixed(2)} USDT pero la ganancia neta del período fue ${netProfitUsdt.toFixed(2)} USDT -- revisa los retiros antes de cerrar este período.`,
    }, { status: 400 });
  }

  const previousCapitalUsdt = account.initialCapitalUsdt ? Number(account.initialCapitalUsdt) : 0;
  const newCapitalUsdt = previousCapitalUsdt + addedUsdt;

  const entry = await prisma.$transaction(async (tx) => {
    await tx.partnerAccount.update({
      where: { id: account.id },
      data: { initialCapitalUsdt: newCapitalUsdt },
    });
    return tx.partnerCapitalLedger.create({
      data: {
        tenantId,
        label: LABEL,
        periodFrom: new Date(periodFromStr + "T00:00:00.000Z"),
        periodTo: new Date(periodToStr + "T23:59:59.999Z"),
        netProfitUsdt,
        totalWithdrawnUsdt,
        addedUsdt,
        previousCapitalUsdt,
        newCapitalUsdt,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    entry: {
      id: entry.id,
      periodFrom: entry.periodFrom.toISOString().slice(0, 10),
      periodTo: entry.periodTo.toISOString().slice(0, 10),
      netProfitUsdt: Number(entry.netProfitUsdt),
      totalWithdrawnUsdt: Number(entry.totalWithdrawnUsdt),
      addedUsdt: Number(entry.addedUsdt),
      previousCapitalUsdt: Number(entry.previousCapitalUsdt),
      newCapitalUsdt: Number(entry.newCapitalUsdt),
      createdAt: entry.createdAt.toISOString(),
    },
  });
}
