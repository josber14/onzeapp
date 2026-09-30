import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, excludeOrdersFromStats, mergeExtraOrdersIntoStats } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Pedido explícito del usuario (sep 2026): con 2 exchanges corriendo
// "Ciclo de Ventas" por separado (Binance y Bybit), tenía que sumar a mano
// cuánto entró en cada uno para saber el total real del día -- este
// endpoint calcula el total CLP del ciclo ACTIVO de venta de cada exchange
// (0 si no hay ninguno activo) y el combinado, para mostrarse igual en
// las dos pantallas ("Resumen combinado" en botCycleRefresh). Reusa
// exactamente el mismo cálculo que ya usa /api/p2p/cycle/status para el
// ciclo activo de cada exchange -- sin guardar nada nuevo, sin tocar la
// lógica de cierre.
async function totalForExchange(tenantId: number, label: string, exchange: string): Promise<number> {
  const cycle = await prisma.p2PCycle.findFirst({
    where: { tenantId, exchange, label, side: "SELL", status: "active" },
    include: { manualSales: true },
  });
  if (!cycle) return 0;

  const startMs = Number(cycle.startTime);
  let stats: any = null;
  try {
    if (exchange === "binance") {
      const creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId, isActive: true, label },
        orderBy: { id: "asc" },
      });
      if (!creds) return Number(cycle.totalManualClp) || 0;
      const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
      stats = await computeCycleOrderStats(client, startMs, undefined, [], "SELL");
    } else {
      stats = await computeLocalCycleStats(prisma, tenantId, exchange, startMs, undefined, "SELL");
    }
  } catch {
    return Number(cycle.totalManualClp) || 0;
  }
  if (!stats) return Number(cycle.totalManualClp) || 0;

  const setAsideRows = await prisma.p2PCycleSetAsideOrder.findMany({
    where: { tenantId, exchange, label, side: "SELL", OR: [{ claimedByCycleId: null }, { claimedByCycleId: cycle.id }] },
  });
  const unclaimed = setAsideRows.filter((o: any) => o.claimedByCycleId === null);
  const claimedByThisCycle = setAsideRows.filter((o: any) => o.claimedByCycleId === cycle.id);
  if (unclaimed.length) {
    stats = excludeOrdersFromStats(stats, new Set(unclaimed.map((o: any) => o.orderNumber)));
  }
  if (claimedByThisCycle.length) {
    stats = mergeExtraOrdersIntoStats(stats, claimedByThisCycle.map((o: any) => ({
      orderNumber: o.orderNumber, amount: o.amount, totalPrice: o.totalPrice, createTime: o.createTime.getTime(),
    })));
  }

  const manualClp = Number(cycle.manualSales?.reduce((sum: number, s: any) => sum + Number(s.amountClp), 0) || cycle.totalManualClp || 0);
  return Number(stats.totalBinanceClp || 0) + manualClp;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const label = searchParams.get("label") || "ONZE";

    // Bybit es una cuenta única fija -- no tiene concepto de ONZE/ZINPLE
    // (ver engine.ts, runBybitCycle: "sin importar bajo qué label esté
    // corriendo el timer del panel, el ciclo de Bybit siempre usa ONZE").
    // Si se buscara con el label de Binance que esté seleccionado en ese
    // momento (ej. ZINPLE), el total de Bybit saldría siempre en 0 aunque
    // haya un ciclo real activo -- el ciclo de Bybit vive siempre bajo
    // "ONZE" en la base, sin importar qué pestaña de Binance se esté
    // mirando.
    const [binanceTotal, bybitTotal] = await Promise.all([
      totalForExchange(session.tenantId, label, "binance"),
      totalForExchange(session.tenantId, "ONZE", "bybit"),
    ]);

    return Response.json({
      ok: true,
      binanceTotal,
      bybitTotal,
      combinedTotal: binanceTotal + bybitTotal,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
