import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeFifo } from "@/lib/partner-fifo";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Detalle de qué órdenes (y pagos manuales) cubrieron un capacity puntual —
// corre el MISMO FIFO que /api/partner/dashboard (import compartido de
// lib/partner-fifo) sobre TODO el historial, porque el reparto de una venta
// entre capacities depende de cuánto quedaba pendiente en los anteriores; no
// se puede calcular mirando solo este capacity de forma aislada.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const capacityId = searchParams.get("capacityId");
  if (!capacityId) {
    return NextResponse.json({ ok: false, error: "Falta capacityId" }, { status: 400 });
  }

  const [account, capacities, allSales, manualPayments] = await Promise.all([
    prisma.partnerAccount.findUnique({ where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } } }),
    prisma.partnerCapacity.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerSale.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerCapacityPayment.findMany({ where: { capacity: { tenantId: session.tenantId, label: LABEL } } }),
  ]);

  const target = capacities.find((c) => c.id === capacityId);
  if (!target) {
    return NextResponse.json({ ok: false, error: "Capacity no encontrado" }, { status: 404 });
  }

  const trackingStart = account?.trackingStartDate ?? null;
  const sales = trackingStart ? allSales.filter((s) => s.executedAt >= trackingStart) : allSales;

  const manualPaymentsByCapacity = new Map<string, number>();
  for (const p of manualPayments) {
    manualPaymentsByCapacity.set(p.capacityId, (manualPaymentsByCapacity.get(p.capacityId) || 0) + Number(p.amountClp));
  }

  const stats = computeFifo(capacities, sales, manualPaymentsByCapacity, { includeOrderDetail: true });
  const breakdown = stats.perCapacityBreakdown.find((c) => c.id === capacityId);
  const orders = (breakdown?.orders || [])
    .slice()
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
    .map((o) => ({
      orderNumber: o.orderNumber,
      executedAt: o.executedAt.toISOString(),
      amount: o.amount,
      clpTotal: o.clpTotal,
      clpTaken: o.clpTaken,
      // Neto (sin la comisión de Binance) — es lo que se muestra en el
      // detalle. El costo/ganancia del capacity siguen calculándose con el
      // bruto (usdtDrawnTotal) en computeFifo, esto es solo para mostrar.
      usdtTaken: o.usdtTakenNet,
      paymentMethod: o.paymentMethod,
    }));

  const manualPaymentsForThis = manualPayments
    .filter((p) => p.capacityId === capacityId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((p) => ({
      id: p.id,
      amountClp: Number(p.amountClp),
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    }));

  return NextResponse.json({
    ok: true,
    capacity: {
      id: target.id,
      provider: target.provider,
      capacityClp: Number(target.capacityClp),
      status: target.status,
    },
    clpCovered: breakdown?.clpCovered || 0,
    orders,
    manualPayments: manualPaymentsForThis,
  });
}
