import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats } from "@/lib/p2p-bot/cycle-stats";

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

    const active = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, label, status: "active" },
      include: { manualSales: true },
    });

    // Mientras el ciclo está activo, totalUsdt/totalBinanceClp en la DB siguen
    // en 0 (solo se calculan de verdad al cerrar) — se calculan en vivo acá
    // consultando Binance, sin guardar nada, para que el panel muestre lo que
    // va entrando en tiempo real.
    let activeWithLiveStats: any = active;
    if (active) {
      try {
        const creds = await prisma.binanceCredentials.findFirst({
          where: { tenantId: session.tenantId, isActive: true, label },
          orderBy: { id: "asc" },
        });
        if (creds) {
          const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
          const stats = await computeCycleOrderStats(client, Number(active.startTime));
          activeWithLiveStats = {
            ...active,
            totalUsdt: stats.totalUsdt,
            totalBinanceClp: stats.totalBinanceClp,
          };
        }
      } catch (e) {
        // si falla la consulta en vivo, se muestra lo que haya guardado (0) en vez de romper el status
      }
    }

    const recent = await prisma.p2PCycle.findMany({
      where: { tenantId: session.tenantId, label, status: "closed" },
      orderBy: { startTime: "desc" },
      take: 100,
      include: { manualSales: true },
    });

    return Response.json({ ok: true, active: activeWithLiveStats, recent });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
