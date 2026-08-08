import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, mapCycleOrdersForDisplay } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista de órdenes reales que entraron en un ciclo YA CERRADO. Pedido
// explícito del usuario (ago 2026): tienen que ser LAS MISMAS que se vieron
// mientras el ciclo estaba activo -- así que primero se sirve el snapshot
// guardado al momento del cierre (P2PCycle.ordersJson, ver close/route.ts y
// autoCloseCycle en engine.ts). Solo para ciclos cerrados ANTES de que
// existiera ese snapshot (ordersJson null) se recalcula en vivo pidiéndole
// de nuevo el historial a Binance -- ese es el camino viejo, que puede
// diferir del que generó los totales guardados porque el endpoint de
// historial de Binance es eventualmente consistente (ya documentado en este
// proyecto).
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) return Response.json({ ok: false, error: "id requerido" }, { status: 400 });

    const cycle = await prisma.p2PCycle.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!cycle) return Response.json({ ok: false, error: "Ciclo no encontrado" }, { status: 404 });

    if (Array.isArray(cycle.ordersJson)) {
      return Response.json({ ok: true, orders: cycle.ordersJson });
    }

    const startMs = new Date(cycle.startTime).getTime();
    const endMs = cycle.endTime ? new Date(cycle.endTime).getTime() : Date.now();

    let orders: any[] = [];
    if (cycle.exchange === "binance") {
      const creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId: session.tenantId, isActive: true, label: cycle.label },
        orderBy: { id: "asc" },
      });
      if (creds) {
        const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
        const stats = await computeCycleOrderStats(client, startMs, endMs);
        orders = stats.orders || [];
      }
    } else {
      const stats = await computeLocalCycleStats(prisma, session.tenantId, cycle.exchange, startMs, endMs);
      orders = stats.orders || [];
    }

    return Response.json({ ok: true, orders: mapCycleOrdersForDisplay(orders) });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
