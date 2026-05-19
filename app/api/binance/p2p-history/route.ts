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

async function fetchFromBinance(apiKey: string, secretKey: string, page: number, startTime?: number, endTime?: number) {
  const params = new URLSearchParams();
  params.set("tradeType", "SELL");
  params.set("page", String(page));
  params.set("rows", "100");
  params.set("recvWindow", "5000");
  params.set("timestamp", String(Date.now()));
  if (startTime) params.set("startTimestamp", String(startTime));
  if (endTime) params.set("endTimestamp", String(endTime));

  const query = params.toString();
  const signature = signQuery(query, secretKey);
  const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || `Binance error: ${res.status}`);

  return Array.isArray(data?.data) ? data.data : [];
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;

    const creds = await prisma.binanceCredentials.findUnique({
      where: { tenantId },
      select: { apiKey: true, secretKey: true, isActive: true },
    });

    if (creds?.apiKey && creds?.secretKey && creds?.isActive) {
      const allOrders: any[] = [];
      let page = 1;
      let fetched: any[];
      const startOf2020 = new Date("2020-01-01").getTime();
      const now = Date.now();

      do {
        fetched = await fetchFromBinance(creds.apiKey, creds.secretKey, page, startOf2020, now);
        const clpSells = fetched.filter(
          (o: any) => o.fiat === "CLP" && o.tradeType === "SELL" && o.orderStatus === "COMPLETED"
        );
        allOrders.push(...clpSells);
        page++;
      } while (fetched.length === 100 && page <= 50);

      for (const o of allOrders) {
        try {
          await prisma.binanceOrder.upsert({
            where: { orderNumber: o.orderNumber },
            update: { orderStatus: o.orderStatus, syncedAt: new Date() },
            create: {
              tenantId,
              orderNumber: o.orderNumber,
              tradeType: "SELL",
              asset: o.asset || "USDT",
              fiat: "CLP",
              amount: parseFloat(o.amount || 0),
              totalPrice: parseFloat(o.totalPrice || 0),
              unitPrice: parseFloat(o.unitPrice || 0),
              commission: parseFloat(o.commission || 0),
              orderStatus: o.orderStatus || "",
              payMethodName: o.payMethodName || null,
              counterPartNickName: o.counterPartNickName || null,
              createTime: BigInt(o.createTime || 0),
              createdAt: new Date(Number(o.createTime || 0)),
            },
          });
        } catch (_e) {}
      }

      return Response.json({
        ok: true,
        total: allOrders.length,
        source: "binance",
        orders: allOrders.map((o: any) => ({
          orderNumber: o.orderNumber,
          tradeType: o.tradeType,
          asset: o.asset,
          fiat: o.fiat,
          amount: parseFloat(o.amount || 0),
          totalPrice: parseFloat(o.totalPrice || 0),
          unitPrice: parseFloat(o.unitPrice || 0),
          commission: parseFloat(o.commission || 0),
          orderStatus: o.orderStatus,
          payMethodName: o.payMethodName || null,
          counterPartNickName: o.counterPartNickName || null,
          createTime: Number(o.createTime || 0),
          createdAt: o.createTime ? new Date(Number(o.createTime)).toISOString() : new Date().toISOString(),
        })),
      });
    }

    const orders = await prisma.binanceOrder.findMany({
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
    return Response.json(
      { ok: false, error: error?.message || "Error consultando órdenes" },
      { status: 500 }
    );
  }
}
