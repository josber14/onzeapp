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

async function getClient(exchange: BotExchange, tenantId: number) {
  if (exchange === "binance") {
    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId, isActive: true },
    });
    if (!creds) throw new Error("Sin credenciales Binance configuradas");
    return { client: new BinanceP2PClient(creds.apiKey, creds.secretKey) as any, exchange };
  }
  if (exchange === "bybit") {
    const creds = await prisma.bybitCredentials.findUnique({
      where: { tenantId, isActive: true },
    });
    if (!creds) throw new Error("Sin credenciales Bybit configuradas");
    return { client: new BybitP2PClient(creds.apiKey, creds.secretKey) as any, exchange };
  }
  throw new Error("Exchange no soportado: " + exchange);
}

export async function fetchLiveMarket(exchange: BotExchange, tenantId: number, side: "0" | "1" = "1") {
  const cacheKey = `market:${exchange}:${side}`;
  const cached = getCached<{ competitors: any[]; totalCompetitors: number; cycleAt: string; ourAd: null; targetPrice: null; fetchAt: string }>(cacheKey);
  if (cached) return cached;

  const { client } = await getClient(exchange, tenantId);

  let rawCompetitors: any[] = [];
  if (exchange === "binance") {
    for (let page = 1; page <= 2; page++) {
      const res = await client.getOnlineAds({
        asset: "USDT", fiat: "CLP", tradeType: side === "1" ? "BUY" : "SELL", rows: 20, page, payTypes: [],
      });
      const pageData = res?.data ?? [];
      if (pageData.length > 0) rawCompetitors = rawCompetitors.concat(pageData);
      if (pageData.length === 0) break;
    }
    rawCompetitors = rawCompetitors.map(normalizeBinanceAd);
  } else {
    const res = await client.getOnlineAds({
      tokenId: "USDT", currencyId: "CLP", side,
    });
    rawCompetitors = res?.result?.items ?? [];
    rawCompetitors = rawCompetitors.map(normalizeBybitAd);
  }

  const competitors = rawCompetitors
    .sort((a: any, b: any) => Number(a.price) - Number(b.price))
    .slice(0, 200)
    .map((c: any, i: number) => ({
      rank: i + 1,
      nickName: c.nickName || c.advertiser?.nickName || "",
      price: Number(c.price),
      minAmount: Number(c.minAmount ?? c.minSingleTransAmount ?? 0),
      maxAmount: Number(c.maxAmount ?? c.maxSingleTransAmount ?? 0),
      available: Number(c.lastQuantity ?? c.quantity ?? c.surplusAmount ?? 0),
      orderCount: Number(c.orderCount ?? c.monthOrderCount ?? 0),
      completionRate: Number(c.completionRate ?? c.monthFinishRate ?? 0),
      paymentMethods: (c.paymentMethods || c.tradeMethods || []).map((pm: any) => ({
        name: pm.name || pm.tradeMethodName || pm.paymentMethodName || String(pm),
        identifier: pm.identifier || pm.paymentMethodId || "",
      })),
    }));

  const result = {
    competitors,
    totalCompetitors: competitors.length,
    cycleAt: new Date().toISOString(),
    ourAd: null,
    targetPrice: null,
  };

  setCache(cacheKey, result, 6000);
  return result;
}

export async function fetchLiveOrders(exchange: BotExchange, tenantId: number, limit = 50) {
  const cacheKey = `orders:${exchange}`;
  const cached = getCached<{ orders: any[] }>(cacheKey);
  if (cached) return cached;

  const { client } = await getClient(exchange, tenantId);

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

function normalizeBinanceAd(ad: any): any {
  const adv = ad.adv ?? ad;
  const advertiser = ad.advertiser ?? {};
  return {
    id: adv.advNo ?? adv.adNo ?? adv.id ?? "",
    tokenId: adv.asset ?? "USDT",
    currencyId: adv.fiatUnit ?? adv.fiat ?? "CLP",
    side: adv.tradeType === "SELL" ? 1 : adv.tradeType === "BUY" ? 0 : (adv.side ?? 1),
    price: Number(adv.price) || 0,
    lastQuantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.lastQuantity ?? adv.quantity ?? 0),
    quantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.lastQuantity ?? adv.quantity ?? 0),
    minAmount: Number(adv.minSingleTransAmount ?? adv.minAmount ?? 0),
    maxAmount: Number(adv.maxSingleTransAmount ?? adv.maxAmount ?? 0),
    paymentMethods: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) => ({
      name: pm.tradeMethodName ?? pm.paymentMethodName ?? pm.name ?? String(pm),
      identifier: pm.paymentMethodId ?? pm.identifier ?? pm.payType ?? "",
    })),
    payments: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) =>
      pm.paymentMethodId ?? pm.identifier ?? pm.payType ?? String(pm)
    ),
    orderCount: Number(advertiser.monthOrderCount ?? adv.orderCount ?? 0),
    completionRate: Number(advertiser.monthFinishRate ?? adv.completionRate ?? 0),
    nickName: advertiser.nickName ?? adv.nickName ?? "",
    userType: advertiser.userType ?? "",
  };
}

function normalizeBybitAd(ad: any): any {
  return {
    id: ad.id ?? ad.itemId ?? ad.adId ?? "",
    tokenId: ad.tokenId ?? "USDT",
    currencyId: ad.currencyId ?? "CLP",
    side: ad.side === 0 ? 0 : 1,
    price: Number(ad.price) || 0,
    lastQuantity: Number(ad.quantity ?? ad.maxQuantity ?? 0),
    quantity: Number(ad.quantity ?? 0),
    minAmount: Number(ad.minAmount ?? 0),
    maxAmount: Number(ad.maxAmount ?? 0),
    paymentMethods: (ad.paymentMethods ?? []).map((pm: any) => ({
      name: pm.name ?? String(pm),
      identifier: pm.identifier ?? String(pm),
    })),
    payments: (ad.paymentMethods ?? []).map((pm: any) => pm.identifier ?? String(pm)),
    orderCount: Number(ad.orderCount ?? 0),
    completionRate: Number(ad.completionRate ?? 0),
    nickName: ad.nickName ?? ad.advertiser?.nickName ?? "",
    userType: ad.userType ?? "",
  };
}
