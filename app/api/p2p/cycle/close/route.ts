import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, mapCycleOrdersForDisplay, excludeOrdersFromStats, mergeExtraOrdersIntoStats } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const label = body.label || "ONZE";
    const exchange = body.exchange || "binance";

    const cycle = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, exchange, label, status: "active" },
      include: { manualSales: true },
    });
    if (!cycle) {
      return Response.json({ ok: false, error: "No hay un ciclo activo para esta etiqueta" });
    }

    const startMs = Number(cycle.startTime);
    const endMs = Date.now();

    let stats: any;
    if (exchange === "binance") {
      const creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId: session.tenantId, isActive: true, label },
        orderBy: { id: "asc" },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Binance" });
      }
      const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
      stats = await computeCycleOrderStats(client, startMs, endMs);
    } else {
      // Bybit/OKX: sin API de historial propia integrada acá todavía --
      // usamos las órdenes que el ciclo del bot ya sincroniza a P2PBotOrder.
      stats = await computeLocalCycleStats(prisma, session.tenantId, exchange, startMs, endMs);
    }

    // Botón "Sacar del ciclo" (ago 2026): mismo criterio que status/route.ts
    // -- lo que sigue sin reclamar se excluye del total que se está por
    // guardar; lo que este mismo ciclo ya reclamó (si el usuario sacó algo y
    // después empezó ESTE ciclo mientras seguía activo) se suma igual.
    const setAsideRows = await prisma.p2PCycleSetAsideOrder.findMany({
      where: { tenantId: session.tenantId, exchange, label, OR: [{ claimedByCycleId: null }, { claimedByCycleId: cycle.id }] },
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
    const { totalUsdt, totalBinanceClp, orderCount, firstOrder, lastOrder, orders } = stats;

    const totalManualClp = Number(cycle.totalManualClp);

    const closed = await prisma.p2PCycle.update({
      where: { id: cycle.id },
      data: {
        status: "closed",
        endTime: new Date(endMs),
        totalUsdt,
        totalBinanceClp,
        totalManualClp,
        firstOrderNumber: firstOrder?.orderNumber ?? null,
        firstOrderClp: firstOrder ? Math.round(Number(firstOrder.totalPrice)) || 0 : null,
        firstOrderTime: firstOrder ? new Date(Number(firstOrder.createTime) || Number(firstOrder.createDate)) : null,
        lastOrderNumber: lastOrder?.orderNumber ?? null,
        lastOrderClp: lastOrder ? Math.round(Number(lastOrder.totalPrice)) || 0 : null,
        lastOrderTime: lastOrder ? new Date(Number(lastOrder.createTime) || Number(lastOrder.createDate)) : null,
        // Pedido explícito del usuario (ago 2026): las órdenes que se ven en
        // el detalle de un ciclo YA CERRADO deben ser las mismas que se
        // vieron mientras estaba activo -- se guarda acá la misma lista que
        // acaba de generar los totales de arriba, en vez de dejar que el
        // detalle vuelva a pedírsela a Binance más tarde (ver
        // mapCycleOrdersForDisplay / P2PCycle.ordersJson).
        ordersJson: mapCycleOrdersForDisplay(orders),
      },
      include: { manualSales: true },
    });

    return Response.json({
      ok: true,
      cycle: closed,
      orderCount,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
