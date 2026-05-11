import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BINANCE_BASE_URL = "https://onze-binance-proxy.josber14.workers.dev";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function signQuery(query: string, secretKey: string) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

interface BinanceSellOrder {
  orderNumber: string;
  amount: number;
  totalPrice: number;
  unitPrice: number;
  commission: number;
  orderStatus: string;
  createTime: number;
  createdAt: string;
}

async function fetchBinanceSellCLP(apiKey: string, secretKey: string): Promise<BinanceSellOrder[]> {
  const params = new URLSearchParams();
  params.set("tradeType", "SELL");
  params.set("page", "1");
  params.set("rows", "100");
  params.set("recvWindow", "5000");
  params.set("timestamp", String(Date.now()));

  const query = params.toString();
  const signature = signQuery(query, secretKey);
  const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || `Binance error: ${res.status}`);

  const allOrders = Array.isArray(data?.data) ? data.data : [];
  const clpSells = allOrders.filter((o: any) => o.fiat === "CLP" && o.tradeType === "SELL");

  return clpSells.map((o: any): BinanceSellOrder => ({
    orderNumber: o.orderNumber || "",
    amount: Number(o.amount || 0),
    totalPrice: Number(o.totalPrice || 0),
    unitPrice: Number(o.unitPrice || 0),
    commission: Number(o.commission || 0),
    orderStatus: o.orderStatus || "",
    createTime: Number(o.createTime || 0),
    createdAt: o.createTime ? new Date(Number(o.createTime)).toISOString() : "",
  }));
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const creds = await prisma.binanceCredentials.findUnique({
      where: { tenantId: session.tenantId },
      select: { apiKey: true, secretKey: true, isActive: true }
    });

    if (!creds || !creds.isActive) {
      return Response.json(
        { ok: false, error: "Credenciales Binance no configuradas. Ve a Ajustes → Binance." },
        { status: 400 }
      );
    }

    const orders = await fetchBinanceSellCLP(creds.apiKey, creds.secretKey);

    return Response.json({
      ok: true,
      total: orders.length,
      orders: orders.sort((a, b) => b.createTime - a.createTime),
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error consultando Binance" },
      { status: 500 }
    );
  }
}
