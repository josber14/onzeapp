import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista de órdenes reales que entraron en un ciclo YA CERRADO -- P2PCycle
// solo guarda totales + primera/última orden, nunca la lista completa (ver
// comentario en computeCycleOrderStats). Se recalcula en vivo con el mismo
// rango [startTime, endTime] del ciclo guardado, igual que ya se hace para
// el ciclo activo en /api/p2p/cycle/status.
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

    const mapped = orders
      .map((o: any) => ({
        orderNumber: o.orderNumber ?? o.orderNo ?? null,
        totalPrice: Number(o.totalPrice) || 0,
        amount: Number(o.amount) || 0,
        createTime: Number(o.createTime) || Number(o.createDate) || (o.executedAt ? new Date(o.executedAt).getTime() : null),
      }))
      .sort((a: any, b: any) => (a.createTime || 0) - (b.createTime || 0));

    return Response.json({ ok: true, orders: mapped });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
