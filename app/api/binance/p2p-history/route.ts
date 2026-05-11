import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const BINANCE_BASE_URL = "https://api.binance.com";

function signQuery(query: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function fetchBinanceC2CHistory(tradeType: "BUY" | "SELL") {
  const apiKey =
    process.env.BINANCE_API_KEY ||
    process.env.BINANCE_KEY;

  const secretKey =
    process.env.BINANCE_SECRET_KEY ||
    process.env.BINANCE_SECRET;

  if (!apiKey || !secretKey) {
    throw new Error("Faltan variables Binance. Configura BINANCE_API_KEY/BINANCE_SECRET_KEY o BINANCE_KEY/BINANCE_SECRET en Netlify.");
  }

  const params = new URLSearchParams({
    tradeType,
    page: "1",
    rows: "100",
    recvWindow: "5000",
    timestamp: Date.now().toString(),
  });

  const signature = signQuery(params.toString(), secretKey);
  params.set("signature", signature);

  const res = await fetch(`${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.msg || `Error Binance ${res.status}`);
  }

  return data;
}

function normalizeOrder(order: any) {
  const amount = Number(order?.amount || 0);
  const totalPrice = Number(order?.totalPrice || 0);
  const unitPrice = Number(order?.unitPrice || 0);
  const commission = Number(order?.commission || order?.takerCommission || 0);

  return {
    source: "binance",
    orderNumber: String(order?.orderNumber || ""),
    tradeType: String(order?.tradeType || ""),
    asset: String(order?.asset || "USDT"),
    fiat: String(order?.fiat || "CLP"),
    amount,
    totalPrice,
    unitPrice,
    commission,
    orderStatus: String(order?.orderStatus || ""),
    payMethodName: String(order?.payMethodName || ""),
    counterPartNickName: String(order?.counterPartNickName || ""),
    createTime: Number(order?.createTime || 0),
    createdAt: order?.createTime ? new Date(Number(order.createTime)).toISOString() : new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const [buyRaw, sellRaw] = await Promise.all([
      fetchBinanceC2CHistory("BUY"),
      fetchBinanceC2CHistory("SELL"),
    ]);

    const buyList = Array.isArray(buyRaw?.data) ? buyRaw.data : [];
    const sellList = Array.isArray(sellRaw?.data) ? sellRaw.data : [];

    const orders = [...buyList, ...sellList]
      .map(normalizeOrder)
      .filter((order) => order.orderNumber)
      .sort((a, b) => b.createTime - a.createTime);

    return NextResponse.json({
      ok: true,
      total: orders.length,
      orders,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "No se pudo consultar Binance P2P.",
      },
      { status: 500 }
    );
  }
}
