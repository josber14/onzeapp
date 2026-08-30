import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, computeCycleProductionStats, excludeOrdersFromStats, mergeExtraOrdersIntoStats } from "@/lib/p2p-bot/cycle-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const active = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, exchange, label, status: "active" },
      include: { manualSales: true },
    });

    // Mientras el ciclo está activo, totalUsdt/totalBinanceClp en la DB siguen
    // en 0 (solo se calculan de verdad al cerrar) — se calculan en vivo acá
    // (Binance: consultando la API en vivo; otros exchanges: leyendo las
    // órdenes que el ciclo del bot ya sincroniza localmente), sin guardar
    // nada, para que el panel muestre lo que va entrando en tiempo real.
    let activeWithLiveStats: any = active;
    let orders: any[] = [];
    let production: any = null;
    let profitEstimate: number | null = null;
    let profitEstimateUsdt: number | null = null;
    let costPriceUsed: number | null = null;
    let setAsideCount = 0;
    let setAsideTotalClp = 0;

    if (active) {
      const startMs = Number(active.startTime);
      try {
        let stats: any = null;
        if (exchange === "binance") {
          const creds = await prisma.binanceCredentials.findFirst({
            where: { tenantId: session.tenantId, isActive: true, label },
            orderBy: { id: "asc" },
          });
          if (creds) {
            const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
            stats = await computeCycleOrderStats(client, startMs);
          }
        } else {
          stats = await computeLocalCycleStats(prisma, session.tenantId, exchange, startMs);
        }
        if (stats) {
          // Botón "Sacar del ciclo" (ago 2026): las ventas apartadas SIN
          // RECLAMAR nunca deben contar en el ciclo activo (el usuario las
          // sacó a propósito). Las que este mismo ciclo YA reclamó (al
          // iniciarse, ver start/route.ts) sí deben sumar, aunque su
          // createTime real sea anterior al startTime de este ciclo -- por
          // eso se agregan aparte, no filtrando por rango de fecha de nuevo.
          const setAsideRows = await prisma.p2PCycleSetAsideOrder.findMany({
            where: { tenantId: session.tenantId, exchange, label, OR: [{ claimedByCycleId: null }, { claimedByCycleId: active.id }] },
          });
          const unclaimed = setAsideRows.filter((o: any) => o.claimedByCycleId === null);
          const claimedByThisCycle = setAsideRows.filter((o: any) => o.claimedByCycleId === active.id);
          if (unclaimed.length) {
            stats = excludeOrdersFromStats(stats, new Set(unclaimed.map((o: any) => o.orderNumber)));
          }
          if (claimedByThisCycle.length) {
            stats = mergeExtraOrdersIntoStats(stats, claimedByThisCycle.map((o: any) => ({
              orderNumber: o.orderNumber, amount: o.amount, totalPrice: o.totalPrice, createTime: o.createTime.getTime(),
            })));
          }
          activeWithLiveStats = {
            ...active,
            totalUsdt: stats.totalUsdt,
            totalBinanceClp: stats.totalBinanceClp,
          };
          orders = (stats.orders || []).slice(-50).reverse();
          // El chip solo cuenta lo que el usuario todavía puede VER en la
          // lista de apartadas (ver GET de set-aside/route.ts) -- una vez
          // eliminada (discarded), sigue excluida de los totales para
          // siempre, pero ya no debe aparecer en el contador.
          const visibleUnclaimed = unclaimed.filter((o: any) => !o.discarded);
          setAsideCount = visibleUnclaimed.length;
          setAsideTotalClp = visibleUnclaimed.reduce((sum: number, o: any) => sum + Math.round(Number(o.totalPrice) || 0), 0);
        }
      } catch (e) {
        // si falla la consulta en vivo, se muestra lo que haya guardado (0) en vez de romper el status
      }

      try {
        production = await computeCycleProductionStats(prisma, session.tenantId, exchange, label, startMs);
      } catch (e) {}

      // Ganancia estimada: costo de la capacity activa AHORA MISMO (no la
      // histórica del inicio del ciclo, que no queda registrada) — se marca
      // explícitamente como estimado por eso.
      try {
        const activeCap = await prisma.p2PCapacity.findFirst({
          where: { tenantId: session.tenantId, status: "active", finishedAt: null },
          orderBy: { createdAt: "asc" },
        });
        if (activeCap?.buyPrice) {
          costPriceUsed = Number(activeCap.buyPrice);
          const totalUsdt = Number(activeWithLiveStats?.totalUsdt || 0);
          const totalClp = Number(activeWithLiveStats?.totalBinanceClp || 0) + Number(active.totalManualClp || 0);
          profitEstimate = totalClp - totalUsdt * costPriceUsed;
          // Mismo estimado, convertido a USDT con el costo de referencia usado arriba.
          profitEstimateUsdt = profitEstimate / costPriceUsed;
        }
      } catch (e) {}
    }

    const recent = await prisma.p2PCycle.findMany({
      where: { tenantId: session.tenantId, exchange, label, status: "closed" },
      orderBy: { startTime: "desc" },
      take: 100,
      include: { manualSales: true },
    });

    // Numeración propia por exchange+cuenta (1, 2, 3...) en vez del id crudo
    // de la tabla (compartido entre todos los exchanges) -- así el primer
    // ciclo que se cierra en Bybit es "Ciclo #1", no el id global de la fila.
    const allIds = await prisma.p2PCycle.findMany({
      where: { tenantId: session.tenantId, exchange, label },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const numberById = new Map(allIds.map((c: any, i: number) => [c.id, i + 1]));
    const withNumber = (c: any) => (c ? { ...c, displayNumber: numberById.get(c.id) ?? c.id } : c);

    return Response.json({
      ok: true,
      active: withNumber(activeWithLiveStats),
      recent: recent.map(withNumber),
      orders,
      production,
      profitEstimate,
      profitEstimateUsdt,
      costPriceUsed,
      setAsideCount,
      setAsideTotalClp,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
