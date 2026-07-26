import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { BybitP2PClient, bybitOrderStatusLabel } from "@/lib/p2p-bot/bybit-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Bybit no cobra comisión en P2P (a diferencia de Binance) -- se guarda
// siempre en 0, no se lee de ningún campo de la API.
function formatOrder(o: any) {
  return {
    orderNumber: String(o.id || ""),
    tradeType: "SELL",
    asset: String(o.tokenId || "USDT"),
    fiat: "CLP",
    amount: Number(o.notifyTokenQuantity || 0),
    totalPrice: Number(o.amount || 0),
    unitPrice: Number(o.price || 0),
    commission: 0,
    orderStatus: bybitOrderStatusLabel(Number(o.status)).toUpperCase(),
    payMethodName: "",
    counterPartNickName: String(o.targetNickName || ""),
    createTime: Number(o.createDate || 0),
    createdAt: o.createDate ? new Date(Number(o.createDate)).toISOString() : new Date().toISOString(),
  };
}

async function fetchAllBybitOrders(client: BybitP2PClient, startTimestamp?: number) {
  const allOrders: any[] = [];
  let page = 1;

  while (page <= 50) {
    const res = await client.getOrders({ page, size: 30 });
    const items = res?.result?.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (
        Number(item.side) === 1 &&
        String(item.currencyId || "").toUpperCase() === "CLP" &&
        Number(item.status) === 50
      ) {
        const createTime = Number(item.createDate || 0);
        if (startTimestamp && createTime < startTimestamp) continue;
        allOrders.push(formatOrder(item));
      }
    }

    if (items.length < 30) break;
    page++;
  }

  return allOrders;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;

    // Bybit es cuenta única (sin ONZE/ZINPLE) -- siempre label "ONZE", igual
    // que ya se resolvió para credenciales/ciclo del bot.
    const creds = await prisma.bybitCredentials.findFirst({
      where: { tenantId, isActive: true, label: "ONZE" },
      orderBy: { id: "asc" },
      select: { apiKey: true, secretKey: true },
    });

    // Mismo cutoff de reset que usa Binance -- es un marcador global del
    // módulo P2P, no específico de un exchange.
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { p2pResetCutoff: true },
    });
    const startTimestamp = settings?.p2pResetCutoff ? Number(settings.p2pResetCutoff) : undefined;

    if (!creds?.apiKey || !creds?.secretKey) {
      const orders = await prisma.bybitOrder.findMany({
        where: { tenantId, fiat: "CLP" },
        orderBy: { createTime: "desc" },
        take: 100,
      });

      return Response.json({
        ok: true,
        total: orders.length,
        source: "database",
        orders: orders.map((o) => ({
          orderNumber: o.orderNumber,
          tradeType: o.tradeType,
          asset: o.asset,
          fiat: o.fiat,
          amount: Number(o.amount),
          totalPrice: Number(o.totalPrice),
          unitPrice: Number(o.unitPrice),
          commission: Number(o.commission),
          orderStatus: o.orderStatus,
          payMethodName: o.payMethodName,
          counterPartNickName: o.counterPartNickName,
          createTime: Number(o.createTime),
          createdAt: o.createdAt.toISOString(),
        })),
      });
    }

    try {
      const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
      const allOrders = await fetchAllBybitOrders(client, startTimestamp);

      for (const o of allOrders) {
        try {
          await prisma.bybitOrder.upsert({
            where: { orderNumber: o.orderNumber },
            update: { orderStatus: o.orderStatus, syncedAt: new Date() },
            create: {
              tenantId,
              orderNumber: o.orderNumber,
              tradeType: "SELL",
              asset: o.asset,
              fiat: "CLP",
              amount: o.amount,
              totalPrice: o.totalPrice,
              unitPrice: o.unitPrice,
              commission: 0,
              orderStatus: o.orderStatus,
              payMethodName: o.payMethodName,
              counterPartNickName: o.counterPartNickName,
              createTime: BigInt(o.createTime),
              createdAt: new Date(o.createTime),
            },
          });
        } catch (_) {}
      }

      return Response.json({
        ok: true,
        total: allOrders.length,
        source: "bybit",
        orders: allOrders,
      });
    } catch (e) {
      console.warn("Bybit live fetch failed, falling back to DB:", e);
    }

    const orders = await prisma.bybitOrder.findMany({
      where: { tenantId, fiat: "CLP" },
      orderBy: { createTime: "desc" },
      take: 100,
    });

    return Response.json({
      ok: true,
      total: orders.length,
      source: "database",
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        tradeType: o.tradeType,
        asset: o.asset,
        fiat: o.fiat,
        amount: Number(o.amount),
        totalPrice: Number(o.totalPrice),
        unitPrice: Number(o.unitPrice),
        commission: Number(o.commission),
        orderStatus: o.orderStatus,
        payMethodName: o.payMethodName,
        counterPartNickName: o.counterPartNickName,
        createTime: Number(o.createTime),
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("BYBIT_P2P_HISTORY_ERROR:", error?.stack || error?.message || error);
    return Response.json(
      {
        ok: false,
        error: error?.message || "Error desconocido consultando Bybit",
        detail: error?.stack?.split("\n").slice(0, 3).join(" | "),
      },
      { status: 500 }
    );
  }
}
