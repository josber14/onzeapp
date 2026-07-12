import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { computeCycleOrderStats } from "@/lib/p2p-bot/cycle-stats";

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

    const cycle = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, label, status: "active" },
      include: { manualSales: true },
    });
    if (!cycle) {
      return Response.json({ ok: false, error: "No hay un ciclo activo para esta etiqueta" });
    }

    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId: session.tenantId, isActive: true, label },
      orderBy: { id: "asc" },
    });
    if (!creds) {
      return Response.json({ ok: false, error: "Sin credenciales Binance" });
    }

    const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);

    const startMs = Number(cycle.startTime);
    const endMs = Date.now();
    const { totalUsdt, totalBinanceClp, orderCount, firstOrder, lastOrder } =
      await computeCycleOrderStats(client, startMs, endMs);

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
