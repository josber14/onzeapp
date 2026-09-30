import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, mapCycleOrdersForDisplay } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pedido explícito del usuario (sep 2026): su trabajadora necesita facturar
// todo lo que entra por Compra, y para eso necesita poder buscar/descargar
// las compras reales de un rango de fechas (no solo del ciclo activo) --
// número de orden, USDT y CLP de cada una, más el total CLP del rango. Esto
// junta las órdenes de TODOS los ciclos de Compra (cerrados y el activo, si
// lo hay) que caigan dentro del rango pedido -- un rango de fechas puede
// cruzar varios ciclos, y el usuario puede haber cerrado y abierto ciclos
// nuevos en el medio.
//
// Solo cuenta órdenes REALES del exchange (con número de orden) -- las
// compras manuales (sin número de orden real) no entran acá a propósito,
// porque no encajan en esa columna; siguen viéndose aparte en el detalle de
// cada ciclo.
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const label = searchParams.get("label") || "ONZE";
    const exchange = searchParams.get("exchange") || "binance";
    const fromMs = Number(searchParams.get("from"));
    const toMs = Number(searchParams.get("to"));
    if (!fromMs || !toMs || toMs < fromMs) {
      return Response.json({ ok: false, error: "Rango de fechas inválido" }, { status: 400 });
    }

    // Cualquier ciclo de Compra que se haya superpuesto con el rango pedido
    // -- cerrado dentro del rango, o el activo (endTime null, sigue corriendo
    // hasta ahora).
    const cycles = await prisma.p2PCycle.findMany({
      where: {
        tenantId: session.tenantId,
        exchange,
        label,
        side: "BUY",
        startTime: { lte: new Date(toMs) },
        OR: [{ endTime: null }, { endTime: { gte: new Date(fromMs) } }],
      },
      orderBy: { startTime: "asc" },
    });

    let creds: any = null;
    if (exchange === "binance" && cycles.some((c) => !Array.isArray(c.ordersJson))) {
      creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId: session.tenantId, isActive: true, label },
        orderBy: { id: "asc" },
      });
    }

    const allOrders: any[] = [];
    for (const cycle of cycles) {
      let orders: any[] = [];
      if (Array.isArray(cycle.ordersJson)) {
        orders = cycle.ordersJson as any[];
      } else {
        const startMs = new Date(cycle.startTime).getTime();
        const endMs = cycle.endTime ? new Date(cycle.endTime).getTime() : Date.now();
        try {
          if (exchange === "binance") {
            if (!creds) continue;
            const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
            const stats = await computeCycleOrderStats(client, startMs, endMs, [], "BUY");
            orders = mapCycleOrdersForDisplay(stats.orders || []);
          } else {
            const stats = await computeLocalCycleStats(prisma, session.tenantId, exchange, startMs, endMs, "BUY");
            orders = mapCycleOrdersForDisplay(stats.orders || []);
          }
        } catch {
          continue;
        }
      }
      allOrders.push(...orders);
    }

    const seen = new Set<string>();
    const inRange = allOrders.filter((o) => {
      const key = String(o.orderNumber || "");
      if (!key || seen.has(key)) return false;
      const t = Number(o.createTime) || 0;
      if (t < fromMs || t > toMs) return false;
      seen.add(key);
      return true;
    });
    inRange.sort((a, b) => (Number(a.createTime) || 0) - (Number(b.createTime) || 0));

    let totalUsdt = 0;
    let totalClp = 0;
    for (const o of inRange) {
      totalUsdt += Number(o.amount) || 0;
      totalClp += Math.round(Number(o.totalPrice) || 0);
    }

    return Response.json({ ok: true, orders: inRange, totalUsdt, totalClp, count: inRange.length });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
