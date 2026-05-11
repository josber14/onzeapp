import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BINANCE_BASE_URL = "https://api.binance.com";

type TradeType = "BUY" | "SELL";

function getBinanceKeys() {
  const apiKey =
    process.env.BINANCE_API_KEY ||
    process.env.BINANCE_KEY;

  const secretKey =
    process.env.BINANCE_SECRET_KEY ||
    process.env.BINANCE_SECRET;

  return { apiKey, secretKey };
}

function chileDayRange(day: string) {
  const now = new Date();

  const chileNowText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, date] = chileNowText.split("-").map(Number);

  const baseUtc = new Date(Date.UTC(year, month - 1, date, 3, 0, 0, 0));

  if (day === "yesterday") {
    baseUtc.setUTCDate(baseUtc.getUTCDate() - 1);
  }

  const start = baseUtc.getTime();
  const end = start + 24 * 60 * 60 * 1000 - 1;

  return { start, end };
}

function signQuery(query: string, secretKey: string) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

async function fetchBinanceC2CHistory(
  tradeType: TradeType,
  apiKey: string,
  secretKey: string,
  startTimestamp?: number,
  endTimestamp?: number
) {
  const params = new URLSearchParams();

  params.set("tradeType", tradeType);
  params.set("page", "1");
  params.set("rows", "100");
  params.set("recvWindow", "5000");

  if (startTimestamp && endTimestamp) {
    params.set("startTimestamp", String(startTimestamp));
    params.set("endTimestamp", String(endTimestamp));
  }

  params.set("timestamp", String(Date.now()));

  const query = params.toString();
  const signature = signQuery(query, secretKey);

  const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data?.msg || data?.message || `Error Binance ${res.status}`
    );
  }

  const list = Array.isArray(data?.data) ? data.data : [];

  return list.map((o: any) => ({
    source: "binance",
    orderNumber: o.orderNumber || o.orderNo || o.id || "",
    tradeType,
    asset: o.asset || "",
    fiat: o.fiat || o.fiatSymbol || "",
    amount: Number(o.amount || 0),
    totalPrice: Number(o.totalPrice || o.total || 0),
    unitPrice: Number(o.unitPrice || o.price || 0),
    commission: Number(o.commission || 0),
    orderStatus: o.orderStatus || o.status || "",
    payMethodName: o.payMethodName || o.payMethod || "",
    counterPartNickName: o.counterPartNickName || o.counterPart || "",
    createTime: Number(o.createTime || 0),
    createdAt: o.createTime ? new Date(Number(o.createTime)).toISOString() : "",
    raw: o,
  }));
}

export async function GET(request: Request) {
  try {
    const { apiKey, secretKey } = getBinanceKeys();

    if (!apiKey || !secretKey) {
      return Response.json(
        {
          ok: false,
          error: "Faltan variables Binance en runtime.",
          envCheck: {
            BINANCE_API_KEY: Boolean(process.env.BINANCE_API_KEY),
            BINANCE_SECRET_KEY: Boolean(process.env.BINANCE_SECRET_KEY),
            BINANCE_KEY: Boolean(process.env.BINANCE_KEY),
            BINANCE_SECRET: Boolean(process.env.BINANCE_SECRET),
            DATABASE_URL: Boolean(process.env.DATABASE_URL),
          },
        },
        { status: 500 }
      );
    }

    const url = new URL(request.url);
    const day = url.searchParams.get("day") || "today";

    let startTimestamp: number | undefined;
    let endTimestamp: number | undefined;

    if (day === "today" || day === "yesterday") {
      const range = chileDayRange(day);
      startTimestamp = range.start;
      endTimestamp = range.end;
    }

    const [buyOrders, sellOrders] = await Promise.all([
      fetchBinanceC2CHistory("BUY", apiKey, secretKey, startTimestamp, endTimestamp),
      fetchBinanceC2CHistory("SELL", apiKey, secretKey, startTimestamp, endTimestamp),
    ]);

    const orders = [...buyOrders, ...sellOrders].sort(
      (a, b) => Number(b.createTime || 0) - Number(a.createTime || 0)
    );

    return Response.json({
      ok: true,
      day,
      total: orders.length,
      orders,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Error consultando Binance P2P.",
      },
      { status: 500 }
    );
  }
}
