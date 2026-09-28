import { BinanceP2PClient } from "./binance-adapter";
import { BybitP2PClient } from "./bybit-adapter";
import { prisma } from "@/lib/prisma";

type BotExchange = "binance" | "bybit" | "okx";

const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function getClient(exchange: BotExchange, tenantId: number, label = "ONZE") {
  if (exchange === "binance") {
    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId, isActive: true, label },
      orderBy: { id: "asc" },
    });
    if (!creds) throw new Error("Sin credenciales Binance configuradas");
    return { client: new BinanceP2PClient(creds.apiKey, creds.secretKey) as any, exchange };
  }
  if (exchange === "bybit") {
    const creds = await prisma.bybitCredentials.findFirst({
      where: { tenantId, isActive: true, label },
      orderBy: { id: "asc" },
    });
    if (!creds) throw new Error("Sin credenciales Bybit configuradas");
    return { client: new BybitP2PClient(creds.apiKey, creds.secretKey) as any, exchange };
  }
  throw new Error("Exchange no soportado: " + exchange);
}

export async function fetchLiveOrders(exchange: BotExchange, tenantId: number, limit = 50, label = "ONZE") {
  // Bug real confirmado en vivo (sep 2026): esta clave de caché NO incluía
  // tenantId ni label -- dos pestañas/cuentas pidiendo órdenes del mismo
  // exchange casi al mismo tiempo podían recibir la lista de la OTRA cuenta
  // durante la ventana de 6s. Muy probablemente la causa real de la alarma
  // de "orden nueva" sonando sin que llegara ninguna orden.
  const cacheKey = `orders:${tenantId}:${label}:${exchange}:${limit}`;
  const cached = getCached<{ orders: any[] }>(cacheKey);
  if (cached) return cached;

  const { client } = await getClient(exchange, tenantId, label);

  let orders: any[] = [];
  if (exchange === "binance") {
    const res = await client.getOrders({ page: 1, rows: limit });
    if (res?.data && Array.isArray(res.data)) {
      orders = res.data;
    } else if (res?.code || res?.error) {
      throw new Error(`Binance API: ${res.error || res.message || 'error desconocido'}`);
    }
  } else {
    const res = await client.getOrders({ page: 1, size: limit });
    orders = res?.result?.items ?? [];
  }

  const mapped = orders.map((o: any) => {
    const rawStatus = o.orderStatus ?? o.status ?? "";
    return {
    id: o.orderNumber ?? o.orderNo ?? o.id ?? o.orderId ?? "",
    orderNumber: o.orderNumber ?? o.orderNo ?? o.id ?? o.orderId ?? "",
    exchange,
    tradeType: o.tradeType === "BUY" || o.side === 0 ? "BUY" : "SELL",
    asset: o.asset ?? o.tokenId ?? "USDT",
    fiat: o.fiat ?? o.currencyId ?? "CLP",
    amount: Number(o.amount ?? o.quantity ?? 0),
    unitPrice: Number(o.price ?? o.unitPrice ?? 0),
    totalPrice: Number(o.totalPrice ?? Number(o.amount ?? 0) * Number(o.price ?? 0)),
    status: rawStatus === "COMPLETED" || rawStatus === 50 || rawStatus === "completed" ? "completed"
      : rawStatus === "CANCELLED" || rawStatus === "CANCELLED_BY_SYSTEM" || rawStatus === 60 || rawStatus === "cancelled" ? "cancelled"
      : rawStatus === "PAID" || rawStatus === "BUYER_PAYED" || rawStatus === 30 ? "paid"
      : rawStatus === "APPEALED" || rawStatus === 40 ? "appealed"
      : rawStatus === "TRADING" || rawStatus === 20 ? "pending"
      : "pending",
    group: rawStatus === "COMPLETED" || rawStatus === 50 || rawStatus === "completed" ? "completed"
      : rawStatus === "CANCELLED" || rawStatus === "CANCELLED_BY_SYSTEM" || rawStatus === 60 || rawStatus === "cancelled" ? "cancelled"
      : rawStatus === "PAID" || rawStatus === "BUYER_PAYED" || rawStatus === 30 ? "pending"
      : "pending",
    counterparty: o.advertiser?.nickName ?? o.nickName ?? o.counterPartNickName ?? o.counterpartNickName ?? o.targetNickName ?? "",
    createdAt: o.createTime ?? o.createdAt ?? o.createDate ?? "",
    paymentMethod: o.payMethodName ?? o.paymentMethod ?? "",
    payTime: Number(o.payTime ?? o.paymentTime ?? o.payWindow ?? 15),
    verified: o.additionalKycVerify === 2 || o.additionalKycVerify === true || o.additionalKycVerify === "2",
    };
  });

  const result = { orders: mapped };
  setCache(cacheKey, result, 5000);
  return result;
}
