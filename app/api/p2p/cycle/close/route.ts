import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";

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

    const ordersRes = await client.getOrders({ page: 1, rows: 100 });
    const allOrders: any[] = [];
    const firstPage = ordersRes?.data || [];
    allOrders.push(...firstPage);
    for (let page = 2; page <= 5; page++) {
      const pageRes = await client.getOrders({ page, rows: 100 });
      const pageData = pageRes?.data || [];
      if (pageData.length === 0) break;
      allOrders.push(...pageData);
    }

    // getOrders() no reenvía un filtro de status a Binance (el endpoint no lo soporta
    // de forma confiable) — hay que filtrar acá por completadas, si no se suman
    // órdenes canceladas/apeladas/en curso que nunca se pagaron de verdad.
    const startMs = Number(cycle.startTime);
    const cycleOrders = allOrders.filter((o: any) => {
      if (o.orderStatus !== "COMPLETED") return false;
      const t = Number(o.createTime) || Number(o.createDate) || 0;
      return t >= startMs;
    });

    let totalUsdt = 0;
    let totalBinanceClp = 0;
    for (const o of cycleOrders) {
      const amount = Number(o.amount) || 0;
      const totalPrice = Number(o.totalPrice) || 0;
      totalUsdt += amount;
      totalBinanceClp += totalPrice;
    }

    const sortedByTime = [...cycleOrders].sort((a: any, b: any) => {
      const ta = Number(a.createTime) || Number(a.createDate) || 0;
      const tb = Number(b.createTime) || Number(b.createDate) || 0;
      return ta - tb;
    });
    const firstOrder = sortedByTime[0];
    const lastOrder = sortedByTime[sortedByTime.length - 1];

    const totalManualClp = Number(cycle.totalManualClp);

    const closed = await prisma.p2PCycle.update({
      where: { id: cycle.id },
      data: {
        status: "closed",
        endTime: new Date(),
        totalUsdt,
        totalBinanceClp,
        totalManualClp,
        firstOrderNumber: firstOrder?.orderNumber ?? null,
        firstOrderClp: firstOrder ? Number(firstOrder.totalPrice) || 0 : null,
        lastOrderNumber: lastOrder?.orderNumber ?? null,
        lastOrderClp: lastOrder ? Number(lastOrder.totalPrice) || 0 : null,
      },
      include: { manualSales: true },
    });

    return Response.json({
      ok: true,
      cycle: closed,
      orderCount: cycleOrders.length,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
