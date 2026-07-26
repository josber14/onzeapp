import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats, computeLocalCycleStats, computeCycleProductionStats } from "@/lib/p2p-bot/cycle-stats";

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
          activeWithLiveStats = {
            ...active,
            totalUsdt: stats.totalUsdt,
            totalBinanceClp: stats.totalBinanceClp,
          };
          orders = (stats.orders || []).slice(-50).reverse();
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

    return Response.json({
      ok: true,
      active: activeWithLiveStats,
      recent,
      orders,
      production,
      profitEstimate,
      profitEstimateUsdt,
      costPriceUsed,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
