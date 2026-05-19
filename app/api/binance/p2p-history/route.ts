import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BINANCE_BASE_URL = "https://api.binance.com";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function signQuery(query: string, secretKey: string) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

function formatOrder(o: any) {
  return {
    orderNumber: String(o.orderNumber || ""),
    tradeType: "SELL",
    asset: String(o.asset || "USDT"),
    fiat: "CLP",
    amount: Number(o.amount || 0),
    totalPrice: Number(o.totalPrice || 0),
    unitPrice: Number(o.unitPrice || 0),
    commission: Number(o.commission || 0),
    orderStatus: String(o.orderStatus || "COMPLETED"),
    payMethodName: String(o.payMethodName || ""),
    counterPartNickName: String(o.counterPartNickName || ""),
    createTime: Number(o.createTime || 0),
    createdAt: o.createTime ? new Date(Number(o.createTime)).toISOString() : new Date().toISOString(),
  };
}

async function fetchAllBinanceOrders(apiKey: string, secretKey: string) {
  const allOrders: any[] = [];
  let page = 1;
  const startTime = new Date("2020-01-01").getTime();
  const endTime = Date.now();

  while (page <= 50) {
    const params = new URLSearchParams();
    params.set("tradeType", "SELL");
    params.set("page", String(page));
    params.set("rows", "100");
    params.set("startTimestamp", String(startTime));
    params.set("endTimestamp", String(endTime));
    params.set("recvWindow", "5000");
    params.set("timestamp", String(Date.now()));

    const query = params.toString();
    const signature = signQuery(query, secretKey);
    const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

    const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json?.msg || `Binance error HTTP ${res.status}`);
    }

    const items = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) break;

    for (const item of items) {
      if (
        String(item.fiat || "").toUpperCase() === "CLP" &&
        String(item.orderStatus || "").toUpperCase() === "COMPLETED"
      ) {
        allOrders.push(formatOrder(item));
      }
    }

    if (items.length < 100) break;
    page++;
  }

  return allOrders;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;

    let apiKey: string | null = null;
    let secretKey: string | null = null;

    const creds = await prisma.binanceCredentials.findUnique({
      where: { tenantId },
      select: { apiKey: true, secretKey: true, isActive: true },
    });

    if (creds?.apiKey && creds?.secretKey && creds?.isActive) {
      apiKey = creds.apiKey;
      secretKey = creds.secretKey;
    }

    if (!apiKey) {
      apiKey = process.env.BINANCE_API_KEY || process.env.BINANCE_KEY || null;
      secretKey = process.env.BINANCE_SECRET_KEY || process.env.BINANCE_SECRET || null;
    }

    if (!apiKey || !secretKey) {
      const orders = await prisma.binanceOrder.findMany({
        where: { tenantId, fiat: "CLP" },
        orderBy: { createTime: "desc" },
        take: 100,
      });

      return Response.json({
        ok: true,
        total: orders.length,
        notice: "Sin credenciales Binance. Muestra datos guardados previamente.",
        source: "database_fallback",
        orders: orders.map((o) => formatOrder(o)),
      });
    }

    const allOrders = await fetchAllBinanceOrders(apiKey, secretKey);

    for (const o of allOrders) {
      try {
        await prisma.binanceOrder.upsert({
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
            commission: o.commission,
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
      source: "binance",
      orders: allOrders,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Error desconocido consultando Binance",
      },
      { status: 500 }
    );
  }
}
