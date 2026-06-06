import { prisma } from "@/lib/prisma";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "./bybit-adapter";
import { BinanceP2PClient } from "./binance-adapter";
import type {
  P2PBotConfigData,
  P2PBotExchangeConfigData,
  BotExchange,
  BotAction,
  BotState,
} from "./types";

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

// ─── In-memory per-tenant bot state ───────────────────────────────
interface AdState {
  updateTimestamps: number[];
  lastUpdateAt: number;
  currentWeight: number;
  lastRateLimitError: number;
  rateLimitBackoffMs: number;
  lastPrice: number;
  lastTarget: number;
  lastPriceUpAt: number;
  priceUpTimestamps: number[];
}
interface BinanceState {
  lastCompetitorFetch: number;
  cachedCompetitors: any[];
  cachedMyAds: any[];
  isFetching: boolean;
  lastCompetitorCount: number;
  adStates: Map<string, AdState>;
}
const binanceStates = new Map<number, BinanceState>();

function getBinanceState(tenantId: number): BinanceState {
  let s = binanceStates.get(tenantId);
  if (!s) {
    s = {
      lastCompetitorFetch: 0,
      cachedCompetitors: [],
      cachedMyAds: [],
      isFetching: false,
      lastCompetitorCount: 0,
      adStates: new Map(),
    };
    binanceStates.set(tenantId, s);
  }
  return s;
}

function getAdState(bs: BinanceState, adId: string): AdState {
  let as = bs.adStates.get(adId);
  if (!as) {
    as = {
      updateTimestamps: [],
      lastUpdateAt: 0,
      currentWeight: 0,
      lastRateLimitError: 0,
      rateLimitBackoffMs: 0,
      lastPrice: 0,
      lastTarget: 0,
      lastPriceUpAt: 0,
      priceUpTimestamps: [],
    };
    bs.adStates.set(adId, as);
  }
  return as;
}

function buildBinanceState(bs: BinanceState): any {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const allTimestamps: number[] = [];
  const allPriceUpTimestamps: number[] = [];
  let minLastUpdate = 0;
  let anyCooldown = 0;
  let maxWeight = 0;
  for (const as of bs.adStates.values()) {
    allTimestamps.push(...as.updateTimestamps.filter(t => t > oneHourAgo));
    allPriceUpTimestamps.push(...as.priceUpTimestamps.filter(t => t > oneHourAgo));
    if (as.lastUpdateAt > minLastUpdate) minLastUpdate = as.lastUpdateAt;
    const backoff = as.rateLimitBackoffMs || 60000;
    if (as.lastRateLimitError > 0 && as.lastRateLimitError + backoff > anyCooldown) anyCooldown = as.lastRateLimitError + backoff;
    if (as.currentWeight > maxWeight) maxWeight = as.currentWeight;
  }
  const active = allTimestamps;
  const activeUp = allPriceUpTimestamps;
  const ultimoCambioHace = minLastUpdate > 0 ? Math.round((now - minLastUpdate) / 1000) : -1;
  const proximoFetchEn = Math.max(0, 6 - Math.round((now - bs.lastCompetitorFetch) / 1000));
  const puedeActualizar = active.length < 30
    && (now - minLastUpdate >= 5000 || minLastUpdate === 0)
    && maxWeight < 4000
    && now >= anyCooldown;
  return {
    cambiosEstaHora: active.length,
    cambiosMax: 30,
    subidasEstaHora: activeUp.length,
    subidasMax: 10,
    ultimoCambioHace,
    weightActual: maxWeight,
    weightMax: 4000,
    proximoFetchEn,
    competidores: bs.lastCompetitorCount || 0,
    puedeActualizar,
  };
}

export async function getBotConfig(
  tenantId: number
): Promise<P2PBotConfigData | null> {
  const config = await prisma.p2PBotConfig.findUnique({
    where: { tenantId },
  });
  if (!config) return null;
  return {
    id: config.id,
    tenantId: config.tenantId,
    enabled: config.enabled,
    strategy: config.strategy as "top1" | "spread",
    top1Diff: Number(config.top1Diff),
    spreadPct: Number(config.spreadPct),
    priceFloorPct: Number(config.priceFloorPct),
    priceSource: (config as any).priceSource || "manual",
    dailyVolumeCapUsdt: config.dailyVolumeCapUsdt
      ? Number(config.dailyVolumeCapUsdt)
      : null,
    circuitBreakPct: Number(config.circuitBreakPct),
    pauseUntil: config.pauseUntil?.toISOString() || null,
    lastStartedAt: config.lastStartedAt?.toISOString() || null,
    lastStoppedAt: config.lastStoppedAt?.toISOString() || null,
    exchanges: (Array.isArray(config.exchanges)
      ? config.exchanges
      : ["binance"]) as BotExchange[],
    competePayTypes: config.competePayTypes as string[] | null,
    commissionPct: Number(config.commissionPct) || 0.14,
    safeMarginPct: Number(config.safeMarginPct) || 0,
  };
}

export async function saveBotConfig(
  tenantId: number,
  data: Partial<P2PBotConfigData>
) {
  const update: any = {};
  if (data.strategy !== undefined) update.strategy = data.strategy;
  if (data.top1Diff !== undefined) update.top1Diff = data.top1Diff;
  if (data.spreadPct !== undefined) update.spreadPct = data.spreadPct;
  if (data.priceFloorPct !== undefined)
    update.priceFloorPct = data.priceFloorPct;
  if (data.priceSource !== undefined) update.priceSource = data.priceSource;
  if (data.dailyVolumeCapUsdt !== undefined)
    update.dailyVolumeCapUsdt = data.dailyVolumeCapUsdt;
  if (data.circuitBreakPct !== undefined)
    update.circuitBreakPct = data.circuitBreakPct;
  if (data.exchanges !== undefined)
    update.exchanges = data.exchanges;
  if (data.enabled !== undefined) update.enabled = data.enabled;
  if (data.competePayTypes !== undefined) update.competePayTypes = data.competePayTypes;
  if (data.commissionPct !== undefined) update.commissionPct = data.commissionPct;
  if (data.safeMarginPct !== undefined) update.safeMarginPct = data.safeMarginPct;

  await prisma.p2PBotConfig.upsert({
    where: { tenantId },
    update,
      create: {
        tenantId,
        enabled: data.enabled ?? false,
        strategy: data.strategy ?? "top1",
        top1Diff: data.top1Diff ?? 0.1,
        spreadPct: data.spreadPct ?? 0.5,
        priceFloorPct: data.priceFloorPct ?? 0,
        dailyVolumeCapUsdt: data.dailyVolumeCapUsdt ?? null,
        circuitBreakPct: data.circuitBreakPct ?? 3,
        exchanges: data.exchanges ?? ["binance", "bybit"],
        competePayTypes: (data.competePayTypes ?? null) as any,
        commissionPct: data.commissionPct ?? 0.14,
        safeMarginPct: data.safeMarginPct ?? 0,
      },
  });
}

export async function startBot(tenantId: number) {
  const config = await getBotConfig(tenantId);
  if (!config) {
    await saveBotConfig(tenantId, { enabled: true });
  } else {
    await prisma.p2PBotConfig.update({
      where: { tenantId },
      data: {
        enabled: true,
        pauseUntil: null,
        lastStartedAt: new Date(),
      },
    });
  }
  await logBot(tenantId, "info", null, "Bot iniciado manualmente");
  return { ok: true };
}

export async function stopBot(tenantId: number) {
  await prisma.p2PBotConfig.update({
    where: { tenantId },
    data: { enabled: false, lastStoppedAt: new Date() },
  });
  await logBot(tenantId, "info", null, "Bot detenido manualmente");
  return { ok: true };
}

export async function getBotStatus(
  tenantId: number
): Promise<BotState | null> {
  const config = await getBotConfig(tenantId);
  if (!config) return null;

  const isPaused =
    config.pauseUntil !== null && new Date(config.pauseUntil) > new Date();

  return {
    running: config.enabled && !isPaused,
    tenantId,
    config,
    lastCycleAt: null,
    lastError: null,
  };
}

export async function getExchangeConfig(
  tenantId: number,
  exchange: BotExchange
): Promise<P2PBotExchangeConfigData | null> {
  const config = await prisma.p2PBotExchangeConfig.findUnique({
    where: { tenantId_exchange: { tenantId, exchange } },
  });
  if (!config) return null;
  return {
    id: config.id,
    tenantId: config.tenantId,
    exchange: config.exchange as BotExchange,
    enabled: config.enabled,
    strategy: config.strategy as "top1" | "spread",
    top1Diff: Number(config.top1Diff),
    spreadPct: Number(config.spreadPct),
    priceFloorPct: Number(config.priceFloorPct),
    priceSource: (config as any).priceSource || "manual",
    dailyVolumeCapUsdt: config.dailyVolumeCapUsdt ? Number(config.dailyVolumeCapUsdt) : null,
    circuitBreakPct: Number(config.circuitBreakPct),
    cycleInterval: Number(config.cycleInterval) || 10,
    minCompetitorCapital: config.minCompetitorCapital ? Number(config.minCompetitorCapital) : null,
    pauseUntil: config.pauseUntil?.toISOString() || null,
    lastStartedAt: config.lastStartedAt?.toISOString() || null,
    lastStoppedAt: config.lastStoppedAt?.toISOString() || null,
    adUpdateCount: config.adUpdateCount,
    competePayTypes: config.competePayTypes as string[] | null,
    commissionPct: Number(config.commissionPct) || 0.14,
    safeMarginPct: Number(config.safeMarginPct) || 0,
  };
}

export async function saveExchangeConfig(
  tenantId: number,
  exchange: BotExchange,
  data: Partial<P2PBotExchangeConfigData>
) {
  const update: any = {};
  if (data.enabled !== undefined) update.enabled = data.enabled;
  if (data.strategy !== undefined) update.strategy = data.strategy;
  if (data.top1Diff !== undefined) update.top1Diff = data.top1Diff;
  if (data.spreadPct !== undefined) update.spreadPct = data.spreadPct;
  if (data.priceFloorPct !== undefined) update.priceFloorPct = data.priceFloorPct;
  if (data.priceSource !== undefined) update.priceSource = data.priceSource;
  if (data.dailyVolumeCapUsdt !== undefined) update.dailyVolumeCapUsdt = data.dailyVolumeCapUsdt;
  if (data.circuitBreakPct !== undefined) update.circuitBreakPct = data.circuitBreakPct;
  if (data.cycleInterval !== undefined) update.cycleInterval = data.cycleInterval;
  if (data.minCompetitorCapital !== undefined) update.minCompetitorCapital = data.minCompetitorCapital;
  if (data.competePayTypes !== undefined) update.competePayTypes = data.competePayTypes;
  if (data.commissionPct !== undefined) update.commissionPct = data.commissionPct;
  if (data.safeMarginPct !== undefined) update.safeMarginPct = data.safeMarginPct;
  if (data.adUpdateCount !== undefined) update.adUpdateCount = data.adUpdateCount;

  await prisma.p2PBotExchangeConfig.upsert({
    where: { tenantId_exchange: { tenantId, exchange } },
    update,
    create: {
      tenantId,
      exchange,
      enabled: data.enabled ?? false,
      strategy: data.strategy ?? "top1",
      top1Diff: data.top1Diff ?? 0.1,
      spreadPct: data.spreadPct ?? 0.5,
      priceFloorPct: data.priceFloorPct ?? 0,
      priceSource: data.priceSource ?? "manual",
      circuitBreakPct: data.circuitBreakPct ?? 3,
      cycleInterval: data.cycleInterval ?? 10,
      minCompetitorCapital: data.minCompetitorCapital ?? null,
      competePayTypes: (data.competePayTypes ?? null) as any,
      commissionPct: data.commissionPct ?? (exchange === "binance" ? 0.14 : 0),
      safeMarginPct: data.safeMarginPct ?? 0,
      adUpdateCount: data.adUpdateCount ?? 0,
    },
  });
}

export async function startExchangeBot(tenantId: number, exchange: BotExchange) {
  await saveExchangeConfig(tenantId, exchange, {
    enabled: true,
    pauseUntil: null,
    lastStartedAt: new Date().toISOString(),
  });
  await logBot(tenantId, "info", exchange, `Bot ${exchange} iniciado manualmente`);
  return { ok: true };
}

export async function stopExchangeBot(tenantId: number, exchange: BotExchange) {
  await prisma.p2PBotExchangeConfig.update({
    where: { tenantId_exchange: { tenantId, exchange } },
    data: { enabled: false, lastStoppedAt: new Date() },
  });
  await logBot(tenantId, "info", exchange, `Bot ${exchange} detenido manualmente`);
  return { ok: true };
}

export async function getExchangeBotStatus(tenantId: number, exchange: BotExchange) {
  const config = await getExchangeConfig(tenantId, exchange);
  if (!config) return { configured: false, enabled: false, running: false };
  const isPaused = config.pauseUntil !== null && new Date(config.pauseUntil) > new Date();
  return {
    configured: true,
    enabled: config.enabled,
    running: config.enabled && !isPaused,
    config,
  };
}

export async function getBotLogs(
  tenantId: number,
  limit = 50,
  level?: string,
  exchange?: string
) {
  const where: any = { tenantId };
  if (level) where.level = level;
  if (exchange) where.exchange = exchange;

  const logs = await prisma.p2PBotLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return logs.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function getBotOrders(
  tenantId: number,
  limit = 50,
  exchange?: string
) {
  const where: any = { tenantId };
  if (exchange) where.exchange = exchange;

  const orders = await prisma.p2PBotOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return orders.map((o) => ({
    ...o,
    amount: Number(o.amount),
    totalPrice: Number(o.totalPrice),
    unitPrice: Number(o.unitPrice),
    commission: o.commission ? Number(o.commission) : null,
    createdAt: o.createdAt.toISOString(),
    executedAt: o.executedAt.toISOString(),
  }));
}

export async function logBot(
  tenantId: number,
  level: string,
  exchange: string | null,
  message: string,
  details?: any
) {
  await prisma.p2PBotLog.create({
    data: { tenantId, level, exchange, message, details: details || undefined },
  });
}

export async function executeBotCycle(tenantId: number) {
  const config = await getBotConfig(tenantId);
  if (!config || !config.enabled) {
    return { ok: false, reason: "Bot not enabled" };
  }

  const isPaused =
    config.pauseUntil !== null && new Date(config.pauseUntil) > new Date();
  if (isPaused) {
    return { ok: false, reason: "Bot paused until " + config.pauseUntil };
  }

  const actions: BotAction[] = [];

  const cycleState: any = {};

  for (const exchange of config.exchanges) {
    try {
      const exchangeConfig = await getExchangeConfig(tenantId, exchange);
      const activeConfig = exchangeConfig || config;

      const exPaused =
        activeConfig.pauseUntil !== null && new Date(activeConfig.pauseUntil) > new Date();
      if (!activeConfig.enabled || exPaused) {
        await logBot(tenantId, "info", exchange, `Bot ${exchange} deshabilitado en su sesión`);
        // Still include state for the exchange
        if (exchange === "binance") cycleState.binance = buildBinanceState(getBinanceState(tenantId));
        continue;
      }

      if (exchange === "binance") {
        const creds = await prisma.binanceCredentials.findFirst({
          where: { tenantId, isActive: true },
        });
        if (!creds) {
          await logBot(tenantId, "warn", "binance", "Sin credenciales Binance configuradas");
          cycleState.binance = buildBinanceState(getBinanceState(tenantId));
          continue;
        }
        try {
          const result = await runBinanceCycle(tenantId, exchangeConfig || config, creds.apiKey, creds.secretKey);
          cycleState.binance = buildBinanceState(getBinanceState(tenantId));
          actions.push(...result.actions);
          if (result.actions.length > 0) {
            await logBot(tenantId, "info", "binance", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
          }
        } catch (e: any) {
          cycleState.binance = buildBinanceState(getBinanceState(tenantId));
          await logBot(tenantId, "error", "binance", `Error en ciclo Binance: ${e.message}`);
        }
      } else if (exchange === "bybit") {
        const creds = await prisma.bybitCredentials.findUnique({
          where: { tenantId, isActive: true },
        });
        if (!creds) {
          await logBot(tenantId, "warn", "bybit", "Sin credenciales Bybit configuradas");
          continue;
        }
        try {
          const result = await runBybitCycle(tenantId, exchangeConfig || config, creds.apiKey, creds.secretKey);
          actions.push(...result.actions);
          if (result.actions.length > 0) {
            await logBot(tenantId, "info", "bybit", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
          }
        } catch (e: any) {
          await logBot(tenantId, "error", "bybit", e.message || "Error en ciclo Bybit");
        }
      } else if (exchange === "okx") {
        const creds = await prisma.okxCredentials.findUnique({
          where: { tenantId, isActive: true },
        });
        if (!creds) {
          await logBot(
            tenantId,
            "warn",
            "okx",
            "Sin credenciales OKX configuradas"
          );
          continue;
        }
        await logBot(
          tenantId,
          "info",
          "okx",
          "OKX integración pendiente de API"
        );
      }
    } catch (e: any) {
      await logBot(tenantId, "error", exchange, e.message || "Error en ciclo");
    }
  }

  return { ok: true, actions, state: cycleState };
}

function normalizeBinanceAd(ad: any): any {
  const adv = ad.adv ?? ad;
  const advertiser = ad.advertiser ?? {};
  const rawTradeType = adv.tradeType;
  const side = rawTradeType === "SELL" ? 1
    : rawTradeType === "BUY" ? 0
    : rawTradeType === 1 ? 1
    : rawTradeType === 0 ? 0
    : (adv.side ?? 1);
  const rawStatus = adv.status ?? adv.advStatus ?? adv.adStatus;
  const status = rawStatus === "ONLINE" || rawStatus === 1 || rawStatus === 10 || rawStatus === "online" ? "online" : "offline";
  return {
    id: adv.advNo ?? adv.adNo ?? adv.id ?? "",
    tokenId: adv.asset ?? "USDT",
    currencyId: adv.fiatUnit ?? adv.fiat ?? "CLP",
    side,
    price: Number(adv.price) || 0,
    lastQuantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.lastQuantity ?? adv.quantity ?? 0),
    quantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.lastQuantity ?? adv.quantity ?? 0),
    minAmount: Number(adv.minSingleTransAmount ?? adv.minAmount ?? 0),
    maxAmount: Number(adv.maxSingleTransAmount ?? adv.maxAmount ?? 0),
    paymentMethods: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) => pm.tradeMethodName ?? pm.paymentMethodName ?? pm.name ?? String(pm)),
    payments: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) =>
      pm.paymentMethodId ?? pm.identifier ?? pm.payType ?? String(pm)
    ),
    paymentPeriod: Number(adv.payTimeLimit ?? adv.paymentPeriod ?? adv.payTime ?? 15),
    status,
    priceType: adv.priceType === "FIXED" ? "0" : adv.priceType === "DYNAMIC" ? "1" : String(adv.priceType ?? "0"),
    orderCount: Number(advertiser.monthOrderCount ?? adv.orderCount ?? 0),
    completionRate: Number(advertiser.monthFinishRate ?? adv.completionRate ?? adv.completedOrderRate ?? 0),
    nickName: advertiser.nickName ?? adv.nickName ?? "",
    userType: advertiser.userType ?? "",
    monthOrderCount: Number(advertiser.monthOrderCount ?? adv.monthOrderCount ?? 0),
    monthExecuteRate: Number(advertiser.monthFinishRate ?? adv.monthExecuteRate ?? 0),
    recentOrderCount: Number(adv.recentOrderCount ?? 0),
    recentExecuteRate: Number(adv.recentExecuteRate ?? 0),
    remark: adv.remark ?? "",
    premium: adv.premium ?? "0",
    itemType: adv.itemType ?? "ORIGIN",
    tradingPreferenceSet: adv.tradingPreferenceSet ?? {},
  };
}

async function runBinanceCycle(
  tenantId: number,
  config: P2PBotConfigData | P2PBotExchangeConfigData,
  apiKey: string,
  secretKey: string
): Promise<{ actions: BotAction[] }> {
  const actions: BotAction[] = [];
  const client = new BinanceP2PClient(apiKey, secretKey);
  const bs = getBinanceState(tenantId);

  try {
    // 1. Get our current ads from Binance
    let myAds: any[] = [];
    try {
      const myAdsRes = await client.getMyAds(1, 50);
      let raw: any[] = [];
      if (Array.isArray(myAdsRes?.data)) raw = myAdsRes.data;
      else if (myAdsRes?.data?.items && Array.isArray(myAdsRes.data.items)) raw = myAdsRes.data.items;
      else if (myAdsRes?.data?.list && Array.isArray(myAdsRes.data.list)) raw = myAdsRes.data.list;
      else if (myAdsRes?.data?.records && Array.isArray(myAdsRes.data.records)) raw = myAdsRes.data.records;
      else if (myAdsRes?.data?.result && Array.isArray(myAdsRes.data.result)) raw = myAdsRes.data.result;
      else if (myAdsRes?.result && Array.isArray(myAdsRes.result)) raw = myAdsRes.result;
      else if (myAdsRes?.list && Array.isArray(myAdsRes.list)) raw = myAdsRes.list;
      myAds = raw.map(normalizeBinanceAd);
      bs.cachedMyAds = myAds;
      if (myAds.length === 0) {
        await logBot(tenantId, "debug", "binance", `Respuesta getMyAds: ${JSON.stringify(myAdsRes).slice(0, 500)}`);
      }
    } catch (e: any) {
      await logBot(tenantId, "error", "binance", `Error getMyAds: ${e.message}`);
      return { actions };
    }

    // 2. Get managed ads from DB
    let managedAds: any[] = [];
    try {
      managedAds = await prisma.p2PBotAd.findMany({
        where: { tenantId, exchange: "binance", botEnabled: true },
      });
      managedAds = managedAds.filter(ma => ma.adId);
      if (managedAds.length === 0) {
        await logBot(tenantId, "info", "binance", "Sin anuncios con bot activado");
        return { actions };
      }
    } catch (e: any) {
      await logBot(tenantId, "warn", "binance", `Error al leer anuncios: ${e.message}`);
      return { actions };
    }

    // Exchange config fallback values
    const exchangeTop1Diff = Number(config.top1Diff) || 0.1;
    const exchangeCommissionPct = Number((config as any).commissionPct) || 0.14;
    const exchangeSafeMarginPct = Number((config as any).safeMarginPct) || 0;
    const exchangeMinCapital = Number((config as any).minCompetitorCapital) || 0;
    const exchangeCompetePayTypes = (config as any).competePayTypes as string[] | null | undefined;
    const exchangeCircuitBreakPct = Number((config as any).circuitBreakPct) || 3;
    const exchangeDailyVolumeCapUsdt = (config as any).dailyVolumeCapUsdt ? Number((config as any).dailyVolumeCapUsdt) : null;

    // 3. Refresh competitors cache if stale
    const now = Date.now();
    if (now - bs.lastCompetitorFetch > 3000 && !bs.isFetching) {
      bs.isFetching = true;
      try {
        let allRaw: any[] = [];
        for (let page = 1; page <= 2; page++) {
          const pageRes = await client.getOnlineAds({
            asset: "USDT", fiat: "CLP", tradeType: "BUY", rows: 20, page, payTypes: [],
          });
          const pageData = pageRes?.data ?? [];
          if (pageData.length > 0) allRaw = allRaw.concat(pageData);
          if (page < 2) await new Promise(r => setTimeout(r, 100));
        }
        bs.cachedCompetitors = allRaw.map(normalizeBinanceAd);
        bs.lastCompetitorFetch = Date.now();
        bs.lastCompetitorCount = bs.cachedCompetitors.length;
        await logBot(tenantId, "info", "binance", `Competidores: ${bs.lastCompetitorCount} items`);
      } catch (e: any) {
        await logBot(tenantId, "warn", "binance", `Fetch competidores: ${e.message}`);
      } finally {
        bs.isFetching = false;
      }
    }

    // Use cached competitors
    const rawCompetitors = bs.cachedCompetitors;

    // Get active capacity (lowest buyPrice among active)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCaps = await prisma.p2PCapacity.findMany({
        where: { tenantId, status: { not: "_capital" }, finishedAt: null },
        orderBy: { buyPrice: "asc" },
        take: 1,
      });
      if (activeCaps.length > 0 && activeCaps[0].buyPrice) activeCapacityBuyPrice = Number(activeCaps[0].buyPrice);
    } catch (e) {}

    // Our sell ads
    const ourSellAds = myAds.filter(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );

    // 4. Process each managed ad
    let firstAdPrice = 0;
    let firstAdTarget = 0;
    for (const managedAd of managedAds) {
      const adId = managedAd.adId;
      const ourSellAd = ourSellAds.find((a: any) => String(a.id) === String(adId));
      if (!ourSellAd) {
        await logBot(tenantId, "warn", "binance", `Ad ${adId}: no encontrado (se saltó)`);
        continue;
      }
      const currentPrice = Number(ourSellAd.price);
      const as = getAdState(bs, adId);
      if (firstAdPrice === 0) firstAdPrice = currentPrice;

      // Per-ad config with exchange fallback (?? null check para permitir 0)
      const adTop1Diff = managedAd.botTop1Diff != null ? Number(managedAd.botTop1Diff) : exchangeTop1Diff;
      const adCommissionPct = managedAd.botCommissionPct != null ? Number(managedAd.botCommissionPct) : exchangeCommissionPct;
      const adSafeMarginPct = managedAd.botSafeMarginPct != null ? Number(managedAd.botSafeMarginPct) : exchangeSafeMarginPct;
      const adMinCapital = managedAd.botMinCompetitorCapital != null ? Number(managedAd.botMinCompetitorCapital) : exchangeMinCapital;
      let adCompetePayTypes = (managedAd.botCompetePayTypes as string[] | null | undefined);
      if (adCompetePayTypes && adCompetePayTypes[0] === 'all') {
        adCompetePayTypes = null;
      } else if (!adCompetePayTypes || !adCompetePayTypes.length) {
        adCompetePayTypes = exchangeCompetePayTypes;
      }
      const adPriceSource = managedAd.botPriceSource || "manual";
      const adPriceFloorPct = managedAd.botPriceFloorPct != null ? Number(managedAd.botPriceFloorPct) : null;
      const adCircuitBreakPct = managedAd.botCircuitBreakPct != null ? Number(managedAd.botCircuitBreakPct) : exchangeCircuitBreakPct;
      const adDailyVolumeCapUsdt = managedAd.botDailyVolumeCapUsdt != null ? Number(managedAd.botDailyVolumeCapUsdt) : exchangeDailyVolumeCapUsdt;

      let minSellPrice = 0;
      // 1) Per-ad price floor override (si el usuario lo configuró explícitamente)
      if (adPriceFloorPct != null && adPriceFloorPct > 0) minSellPrice = adPriceFloorPct;
      // 2) Si no hay manual, usar capacity activa
      if (minSellPrice <= 0 && activeCapacityBuyPrice) minSellPrice = activeCapacityBuyPrice;
      if (minSellPrice <= 0) {
        await logBot(tenantId, "warn", "binance", `Ad ${adId}: sin precio mínimo`);
        continue;
      }
      const priceFloor = minSellPrice * (1 + adCommissionPct / 100);

      // Filter competitors for this ad
      let competitors = [...rawCompetitors];

      // Payment filter
      let ourPayMethods: string[] | undefined;
      let rawPayTypes = adCompetePayTypes;
      if (typeof rawPayTypes === "string") {
        if (rawPayTypes === "all" || rawPayTypes === "*") rawPayTypes = null;
      }
      if (rawPayTypes && rawPayTypes.length > 0 && rawPayTypes[0] !== "*") {
        if (rawPayTypes[0] === "__match_ad__") {
          if (ourSellAd?.payments?.length) ourPayMethods = ourSellAd.payments.map((p: any) => String(p));
        } else if (Array.isArray(rawPayTypes)) {
          ourPayMethods = rawPayTypes;
        }
        if (ourPayMethods && ourPayMethods.length > 0) {
          competitors = competitors.filter((c: any) => {
            const cmpIds = (c.payments || []).map((p: any) => String(p));
            return cmpIds.some((p: string) => ourPayMethods!.includes(p));
          });
        }
      }
      if (competitors.length === 0) {
        await logBot(tenantId, "warn", "binance", `Ad ${adId}: sin competidores tras filtro`);
        continue;
      }

      // Viability filters
      const viable = competitors.filter((c: any) => {
        if (Number(c.price) < minSellPrice) return false;
        if (!c.userType || c.userType !== "merchant") return false;
        if (adMinCapital > 0) {
          const cap = Number(c.lastQuantity ?? c.surplusAmount ?? c.tradableQuantity ?? c.quantity ?? 0);
          if (cap < adMinCapital) return false;
        }
        return true;
      });
      if (viable.length === 0) { continue; }

      viable.sort((a: any, b: any) => Number(a.price) - Number(b.price));
      const myAdIds = new Set(myAds.map((a: any) => a.id));
      const sortedCompetitors = viable.filter((c: any) => !myAdIds.has(c.id));
      if (sortedCompetitors.length === 0) { continue; }

      // Safe margin filter
      const viableCompetitors: any[] = [];
      for (let i = 0; i < sortedCompetitors.length; i++) {
        const comp = sortedCompetitors[i];
        const marginPct = priceFloor > 0 ? ((Number(comp.price) - priceFloor) / priceFloor) * 100 : 999;
        if (marginPct >= adSafeMarginPct) viableCompetitors.push(comp);
      }

      // Safe margin floor (incluye comisión + margen de seguridad)
      const safeFloor = priceFloor * (1 + adSafeMarginPct / 100);
      // Target calculation
      let targetCompetitor: any = null;
      let targetIndex = -1;

      if (viableCompetitors.length === 0 && sortedCompetitors.length > 0) {
        let closestAbove: any = null;
        for (let i = 0; i < sortedCompetitors.length; i++) {
          const comp = sortedCompetitors[i];
          if (Number(comp.price) > currentPrice) { closestAbove = comp; targetIndex = i; break; }
        }
        if (closestAbove) {
          const testPrice = Number(closestAbove.price) - adTop1Diff;
          if (testPrice > safeFloor) { targetCompetitor = closestAbove; }
        }
      } else if (viableCompetitors.length > 0) {
        const firstComp = viableCompetitors[0];
        const firstTargetRaw = Number(firstComp.price) - adTop1Diff;
        if (firstTargetRaw > safeFloor) {
          targetCompetitor = firstComp; targetIndex = 0;
        } else {
          for (let i = 1; i < viableCompetitors.length; i++) {
            const comp = viableCompetitors[i];
            const testPrice = Number(comp.price) - adTop1Diff;
            if (testPrice > safeFloor) { targetCompetitor = comp; targetIndex = i; break; }
          }
        }
        if (!targetCompetitor) {
          const highest = viableCompetitors[viableCompetitors.length - 1];
          const testPrice = Number(highest.price) - adTop1Diff;
          if (testPrice > safeFloor) { targetCompetitor = highest; targetIndex = viableCompetitors.length - 1; }
        }
      }

      let targetPrice = currentPrice;
      if (targetCompetitor) {
        targetPrice = Number(targetCompetitor.price) - adTop1Diff;
      }
      // Nunca quedarse debajo del safeFloor (reglas 1 y 2)
      if (targetPrice < safeFloor) { targetPrice = Math.max(currentPrice, safeFloor); }
      if (firstAdTarget === 0) firstAdTarget = targetPrice;

      const diff = Math.abs(currentPrice - targetPrice);
      if (diff < 0.005) continue;

      // ── Price recovery check (targetPrice > currentPrice) ──
      const isPriceUp = targetPrice > currentPrice;
      if (isPriceUp) {
        const oneHourAgo = Date.now() - 3600000;
        as.priceUpTimestamps = as.priceUpTimestamps.filter(t => t > oneHourAgo);
        as.currentWeight = Math.max(as.currentWeight, client.latestWeight);

        if (as.currentWeight >= 4000) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: weight ${as.currentWeight} ≥ 4000, pausando subida`);
          continue;
        }
        if (as.lastRateLimitError > 0 && Date.now() - as.lastRateLimitError < as.rateLimitBackoffMs) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: cooldown activo, saltando subida`);
          continue;
        }
        if (as.priceUpTimestamps.length >= 10) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: límite 10 subidas/hora alcanzado, saltando`);
          continue;
        }
        if (as.lastPriceUpAt > 0 && (Date.now() - as.lastPriceUpAt < 1000)) {
          await logBot(tenantId, "debug", "binance", `Ad ${adId}: gap subida <1s, esperando`);
          continue;
        }
      } else {
        as.currentWeight = Math.max(as.currentWeight, client.latestWeight);
        const oneHourAgo = Date.now() - 3600000;
        as.updateTimestamps = as.updateTimestamps.filter(t => t > oneHourAgo);

        if (as.updateTimestamps.length >= 30) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: límite 30/hr alcanzado (${as.updateTimestamps.length}), saltando`);
          continue;
        }
        if (as.lastUpdateAt > 0 && (Date.now() - as.lastUpdateAt < 30000)) {
          await logBot(tenantId, "debug", "binance", `Ad ${adId}: gap <30s desde último update, esperando`);
          continue;
        }
        if (as.currentWeight >= 4000) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: weight ${as.currentWeight} ≥ 4000, pausando`);
          continue;
        }
        if (as.lastRateLimitError > 0 && Date.now() - as.lastRateLimitError < as.rateLimitBackoffMs) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: cooldown rate-limit (${Math.round((Date.now() - as.lastRateLimitError) / 1000)}s), saltando`);
          continue;
        }
      }

      // ── Execute update ──
      try {
        const fullAd = ourSellAd;
        await client.updateAd({
          adId,
          price: targetPrice.toFixed(2),
        });
        as.lastUpdateAt = Date.now();
        as.rateLimitBackoffMs = 0;
        if (isPriceUp) {
          as.priceUpTimestamps.push(Date.now());
          as.lastPriceUpAt = Date.now();
        } else {
          as.updateTimestamps.push(Date.now());
        }
        actions.push({ action: "update_price", exchange: "binance", adId, currentPrice, suggestedPrice: targetPrice, reason: `Precio: ${currentPrice} → ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
        if (isPriceUp) {
          await logBot(tenantId, "info", "binance", `Ad ${adId}: ${currentPrice} → ${targetPrice.toFixed(2)} (${as.priceUpTimestamps.length}/10 subidas esta hora)`);
        } else {
          await logBot(tenantId, "info", "binance", `Ad ${adId}: ${currentPrice} → ${targetPrice.toFixed(2)} (${as.updateTimestamps.length}/30 esta hora)`);
        }
      } catch (e: any) {
        if (e.message?.includes("code: -9000") || e.message?.includes("code: -1000") || e.message?.includes("429")) {
          as.lastRateLimitError = Date.now();
          as.rateLimitBackoffMs = 60000;
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: ${e.message.split('(')[0].trim()} — backoff ${Math.round(as.rateLimitBackoffMs / 1000)}s`);
        } else if (e.message?.includes("83229") || e.message?.includes("83230")) {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: ad offline (${e.message}), saltando`);
        } else {
          await logBot(tenantId, "warn", "binance", `Ad ${adId}: error update: ${e.message}`);
        }
      }

      // 5s gap between ads
      if (managedAds.length > 1 && managedAds.indexOf(managedAd) < managedAds.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // 5. Sync orders
    try {
      const ordersRes = await client.getOrders({ page: 1, rows: 30 });
      const binanceOrders = ordersRes?.data ?? [];
      for (const o of binanceOrders) {
        const orderId = o.orderNo ?? o.id;
        const existing = await prisma.p2PBotOrder.findFirst({
          where: { tenantId, orderNumber: orderId, exchange: "binance" },
        });
        if (!existing) {
          await prisma.p2PBotOrder.create({
            data: {
              tenantId, exchange: "binance", orderNumber: orderId,
              tradeType: o.tradeType === "SELL" ? "SELL" : "BUY",
              asset: o.asset || "USDT", fiat: o.fiat || "CLP",
              amount: Number(o.amount ?? o.totalQuantity ?? 0),
              totalPrice: Number(o.totalPrice ?? o.totalAmount ?? 0),
              unitPrice: Number(o.unitPrice ?? o.price ?? 0),
              status: o.orderStatus ?? o.status ?? "unknown",
              counterparty: o.counterpartyNickName ?? o.publisherName ?? "",
              executedAt: o.createTime ? new Date(o.createTime) : new Date(),
            },
          });
        }
      }
    } catch (e: any) {
      if (!e.message?.includes("-9000") && !e.message?.includes("-1000")) {
        await logBot(tenantId, "warn", "binance", `Error órdenes: ${e.message}`);
      }
    }

    // Update stored price/target for UI
    await logBot(tenantId, "info", "binance", `Ciclo completado: managedAds: ${managedAds.length}`);
  } catch (e: any) {
    await logBot(tenantId, "error", "binance", `Error en ciclo: ${e.message}`);
  }

  return { actions };
}

async function runBybitCycle(
  tenantId: number,
  config: P2PBotConfigData | P2PBotExchangeConfigData,
  apiKey: string,
  secretKey: string
): Promise<{ actions: BotAction[] }> {
  const actions: BotAction[] = [];
  const client = new BybitP2PClient(apiKey, secretKey);

  try {
    // 1. Get our current balance (non-critical, continue if fails)
    let bybitBalance = 0;
    try {
      const balanceRes = await client.getBalance("USDT");
      const usdtCoin = balanceRes?.result?.balance?.find((c: any) => c.coin === "USDT");
      bybitBalance = usdtCoin ? Number(usdtCoin.walletBalance) : 0;
      await logBot(tenantId, "info", "bybit", `Saldo USDT: ${bybitBalance}`);
    } catch (e: any) {
      await logBot(tenantId, "warn", "bybit", `Balance no disponible: ${e.message}`);
    }

    // 2. Get our current ads from Bybit
    let myAds: any[] = [];
    try {
      const myAdsRes = await client.getMyAds(1, 50);
      myAds = myAdsRes?.result?.items || [];
    } catch (e: any) {
      await logBot(tenantId, "error", "bybit", `Error getMyAds: ${e.message}`);
      throw e;
    }

    // 3. Get all bot-enabled ads from DB
    let managedAds: any[] = [];
    try {
      managedAds = await prisma.p2PBotAd.findMany({
        where: { tenantId, exchange: "bybit", botEnabled: true },
      });
      managedAds = managedAds.filter(ma => ma.adId);
      if (managedAds.length === 0) {
        await logBot(tenantId, "info", "bybit", "Sin anuncios con bot activado. Actívalo en cada anuncio desde el panel.");
        return { actions };
      }
    } catch (e: any) {
      await logBot(tenantId, "warn", "bybit", `Error al leer anuncios gestionados: ${e.message}`);
      return { actions };
    }

    // Bybit exchange config fallbacks
    const exchangeTop1Diff = Number(config.top1Diff) || 0.1;
    const exchangeSafeMarginPct = Number((config as any).safeMarginPct) || 0;
    const exchangeMinCapital = Number((config as any).minCompetitorCapital) || 0;
    const exchangePriceSource = (config as any).priceSource || "manual";
    const exchangePriceFloorPct = (config as any).priceFloorPct ? Number((config as any).priceFloorPct) : 0;

    // Our sell ads
    const ourSellAds = myAds.filter(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );

    // 4. Get online competitor ads (once)
    let rawCompetitors: any[] = [];
    try {
      const onlineRes = await client.getOnlineAds({
        tokenId: "USDT",
        currencyId: "CLP",
        side: "1",
      });
      rawCompetitors = onlineRes?.result?.items || [];
    } catch (e: any) {
      await logBot(tenantId, "error", "bybit", `Error getOnlineAds: ${e.message}`);
      throw e;
    }
    await logBot(tenantId, "info", "bybit", `OnlineAds: ${rawCompetitors.length} items`);

    // Get active capacity (lowest buyPrice among active)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCaps = await prisma.p2PCapacity.findMany({
        where: { tenantId, status: { not: "_capital" }, finishedAt: null },
        orderBy: { buyPrice: "asc" },
        take: 1,
      });
      if (activeCaps.length > 0 && activeCaps[0].buyPrice) activeCapacityBuyPrice = Number(activeCaps[0].buyPrice);
    } catch (e) {}

    // 5. Process each managed ad independently
    for (const managedAd of managedAds) {
      const adId = managedAd.adId;
      const ourSellAd = ourSellAds.find((a: any) => String(a.id) === String(adId));
      if (!ourSellAd) {
        await logBot(tenantId, "warn", "bybit", `Ad ${adId}: no encontrado en mis anuncios`);
        continue;
      }
      const currentPrice = Number(ourSellAd.price);

      // Per-ad config with fallback
      const adTop1Diff = managedAd.botTop1Diff != null ? Number(managedAd.botTop1Diff) : exchangeTop1Diff;
      const adSafeMarginPct = managedAd.botSafeMarginPct != null ? Number(managedAd.botSafeMarginPct) : exchangeSafeMarginPct;
      const adMinCapital = managedAd.botMinCompetitorCapital != null ? Number(managedAd.botMinCompetitorCapital) : exchangeMinCapital;
      const adPriceSource = managedAd.botPriceSource || exchangePriceSource;
      const adPriceFloorPct = managedAd.botPriceFloorPct != null ? Number(managedAd.botPriceFloorPct) : null;

      // Min sell price
      let minSellPrice = 0;
      if (adPriceFloorPct != null && adPriceFloorPct > 0) minSellPrice = adPriceFloorPct;
      if (minSellPrice <= 0 && activeCapacityBuyPrice) minSellPrice = activeCapacityBuyPrice;
      if (minSellPrice <= 0) {
        await logBot(tenantId, "warn", "bybit", `Ad ${adId}: sin precio mínimo`);
        continue;
      }
      await logBot(tenantId, "info", "bybit", `Ad ${adId}: minSell=${minSellPrice}, top1Diff=${adTop1Diff}, safeMargin=${adSafeMarginPct}%`);

      // Filter & sort competitors
      let competitors = rawCompetitors.filter((c: any) => {
        if (Number(c.price) < minSellPrice) return false;
        if (adMinCapital > 0) {
          const cap = Number(c.lastQuantity ?? c.surplusAmount ?? c.tradableQuantity ?? c.quantity ?? 0);
          if (cap < adMinCapital) return false;
        }
        return true;
      });
      if (competitors.length === 0) {
        await logBot(tenantId, "info", "bybit", `Ad ${adId}: sin competidores viables`);
        continue;
      }
      competitors.sort((a: any, b: any) => Number(a.price) - Number(b.price));

      const myAdIds = new Set(myAds.map((a: any) => a.id));
      const sortedCompetitors = competitors.filter((c: any) => !myAdIds.has(c.id));
      if (sortedCompetitors.length === 0) {
        await logBot(tenantId, "info", "bybit", `Ad ${adId}: solo nuestros anuncios`);
        continue;
      }

      // Safe margin floor (incluye margen de seguridad)
      const safeFloor = minSellPrice * (1 + adSafeMarginPct / 100);

      // Safe margin filter
      let targetCompetitor: any = null;
      let targetIndex = 0;
      for (let i = 0; i < sortedCompetitors.length; i++) {
        const comp = sortedCompetitors[i];
        const marginPct = minSellPrice > 0 ? ((Number(comp.price) - minSellPrice) / minSellPrice) * 100 : 999;
        if (marginPct >= adSafeMarginPct) {
          const testPrice = Number(comp.price) - adTop1Diff;
          if (testPrice > safeFloor) {
            targetCompetitor = comp;
            targetIndex = i;
            break;
          }
        }
      }

      // Fallback: closest above current price (respetando safeFloor)
      if (!targetCompetitor && sortedCompetitors.length > 0) {
        for (let i = 0; i < sortedCompetitors.length; i++) {
          const comp = sortedCompetitors[i];
          if (currentPrice > 0 && Number(comp.price) > currentPrice) {
            const testPrice = Number(comp.price) - adTop1Diff;
            if (testPrice > safeFloor) {
              targetCompetitor = comp;
              targetIndex = i;
              await logBot(tenantId, "warn", "bybit", `Ad ${adId}: sin margen/piso, usando más cercano sobre precio: ${Number(targetCompetitor.price).toFixed(2)}`);
              break;
            }
          }
        }
      }

      let targetPrice = currentPrice;
      if (targetCompetitor) {
        await logBot(tenantId, "info", "bybit", `Ad ${adId}: target #${targetIndex + 1}: ${Number(targetCompetitor.price).toFixed(2)}`);
        const targetRaw = Number(targetCompetitor.price) - adTop1Diff;
        if (targetRaw > safeFloor) {
          targetPrice = targetRaw;
        } else {
          await logBot(tenantId, "warn", "bybit", `Ad ${adId}: target bajo piso seguro, manteniendo ${currentPrice.toFixed(2)}`);
        }
      } else {
        await logBot(tenantId, "warn", "bybit", `Ad ${adId}: sin target sobre piso seguro, manteniendo ${currentPrice.toFixed(2)}`);
      }
      // Nunca quedarse debajo del safeFloor (reglas 1 y 2)
      if (targetPrice < safeFloor) { targetPrice = Math.max(currentPrice, safeFloor); }

      // Update ad
      const diff = Math.abs(currentPrice - targetPrice);
      if (diff >= 0.005) {
        let fullAd: any = ourSellAd;
        let paymentIds: string[] = [];
        let strTps: any = {};
        try {
          // Use data from getMyAds; getAdDetail is redundant slow API call
          const payObjs = fullAd.paymentTerms ?? fullAd.payments ?? [];
          paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];
          const tps = fullAd.tradingPreferenceSet ?? {};
          for (const k of Object.keys(tps)) strTps[k] = String(tps[k] ?? "");

          const updateQuantity = bybitBalance > 0 ? String(bybitBalance) : String(fullAd.lastQuantity ?? fullAd.quantity ?? "0");
          const fiatMaxAmount = bybitBalance > 0 ? String(Number(updateQuantity) * targetPrice) : String(fullAd.maxAmount ?? "0");
          const rawMin = String(fullAd.minAmount ?? "0");
          const cappedMin = Number(rawMin) > Number(fiatMaxAmount) ? fiatMaxAmount : rawMin;
          const updateFields: any = {
            id: adId,
            price: targetPrice.toFixed(2),
            actionType: "MODIFY",
            priceType: String(fullAd.priceType ?? "0"),
            premium: String(fullAd.premium ?? "0"),
            quantity: updateQuantity,
            minAmount: cappedMin,
            maxAmount: fiatMaxAmount,
            paymentPeriod: String(fullAd.paymentPeriod ?? "15"),
            paymentIds,
            remark: String(fullAd.remark ?? ""),
            tradingPreferenceSet: strTps,
          };
          await client.updateAd(updateFields);
          actions.push({ action: "update_price", exchange: "bybit", adId, currentPrice, suggestedPrice: targetPrice, reason: `Ad ${adId} actualizado a ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
          await logBot(tenantId, "info", "bybit", `Ad ${adId} precio actualizado: ${currentPrice} → ${targetPrice.toFixed(2)}`);
        } catch (e: any) {
          if (e.message?.includes("912120050")) {
            await logBot(tenantId, "info", "bybit", `Rate limit, recreando anuncio ${adId}...`);
            await client.removeAd(adId);
            const recreatePrice = targetPrice + Math.max(2.0, currentPrice * 0.01);
            const postFields: any = {
              tokenId: "USDT", currencyId: "CLP", side: "1",
              price: recreatePrice.toFixed(2),
              priceType: String(fullAd.priceType ?? "0"),
              premium: String(fullAd.premium ?? "0"),
              quantity: String(fullAd.lastQuantity ?? fullAd.quantity ?? "0"),
              minAmount: String(fullAd.minAmount ?? "0"),
              maxAmount: String(fullAd.maxAmount ?? "0"),
              paymentPeriod: String(fullAd.paymentPeriod ?? "15"),
              paymentIds,
              remark: String(fullAd.remark ?? ""),
              tradingPreferenceSet: strTps,
              itemType: String(fullAd.itemType ?? "ORIGIN"),
              status: 10,
            };
            try {
              const newAdRes = await client.postAd(postFields);
              const newAdId = newAdRes?.result?.item?.id ?? newAdRes?.result?.id;
              if (newAdId) {
                // Activate online (same format as 912120031 handler)
                await new Promise(r => setTimeout(r, 2000));
                try {
                  await client.updateAd({ id: String(newAdId), status: 10 });
                  await logBot(tenantId, "info", "bybit", `Anuncio ${newAdId} creado y activado online`);
                } catch (e3: any) {
                  await logBot(tenantId, "warn", "bybit", `Anuncio ${newAdId}: no se pudo activar online (${e3.message}), reintentando próximo ciclo`);
                }
                actions.push({ action: "recreate_ad", exchange: "bybit", adId: newAdId, suggestedPrice: targetPrice, reason: `Nuevo anuncio creado tras rate-limit`, timestamp: Date.now() });
                await prisma.p2PBotAd.update({
                  where: { id: managedAd.id },
                  data: { adId: String(newAdId) },
                });
                await logBot(tenantId, "info", "bybit", `Anuncio recreado como ${newAdId}`);
              }
            } catch (e2: any) {
              await logBot(tenantId, "warn", "bybit", `Ad ${adId}: error al recrear: ${e2.message}`);
            }
          } else if (e.message?.includes("912120031")) {
            await logBot(tenantId, "info", "bybit", `Ad ${adId} offline, reactivando para próximo ciclo...`);
            try {
              await client.updateAd({ id: adId, status: 10 } as any);
              await logBot(tenantId, "info", "bybit", `Ad ${adId} reactivado`);
            } catch(e2: any) {
              await logBot(tenantId, "warn", "bybit", `Ad ${adId}: no se pudo reactivar: ${e2.message}`);
            }
          } else {
            await logBot(tenantId, "warn", "bybit", `Ad ${adId}: error actualización: ${e.message}`);
          }
        }
      }

      // Snapshot per ad
      try {
        await prisma.p2PBotMarketSnapshot.create({
          data: {
            tenantId,
            exchange: "bybit",
            side: "1",
            competitors: JSON.parse(JSON.stringify(sortedCompetitors.slice(0, 50).map((c: any) => ({
              id: c.id, nickName: c.nickName, price: Number(c.price),
              minAmount: Number(c.minAmount ?? 0), maxAmount: Number(c.maxAmount ?? 0),
              lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
              orderCount: Number(c.orderCount ?? 0), completionRate: Number(c.completionRate ?? 0),
            })))),
            ourAd: JSON.parse(JSON.stringify({ id: ourSellAd.id, price: Number(ourSellAd.price), lastQuantity: Number(ourSellAd.lastQuantity ?? ourSellAd.quantity ?? 0) })),
            targetPrice: targetPrice ?? undefined,
          },
        });
      } catch (e: any) {}
      if (managedAds.length > 1 && managedAds.indexOf(managedAd) < managedAds.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 6. Sync orders from Bybit to local DB (once)
    let bybitOrders: any[] = [];
    try {
      const ordersRes = await client.getOrders({ page: 1, size: 30 });
      bybitOrders = ordersRes?.result?.items || [];
      for (const o of bybitOrders) {
        const existing = await prisma.p2PBotOrder.findFirst({
          where: { tenantId, orderNumber: o.id, exchange: "bybit" },
        });
        if (!existing) {
          await prisma.p2PBotOrder.create({
            data: {
              tenantId, exchange: "bybit", orderNumber: o.id,
              tradeType: o.side === 0 ? "BUY" : "SELL",
              asset: o.tokenId || "USDT", fiat: o.currencyId || "CLP",
              amount: Number(o.amount) || 0,
              totalPrice: Number(o.amount) * Number(o.price) || 0,
              unitPrice: Number(o.price) || 0,
              status: bybitOrderStatusLabel(Number(o.status)),
              counterparty: o.targetNickName || "",
              executedAt: new Date(Number(o.createDate)),
            },
          });
        }
      }
    } catch (e: any) {}

    await logBot(tenantId, "info", "bybit", `Ciclo completado: ${bybitOrders.length} órdenes, managedAds: ${managedAds.length}`);
  } catch (e: any) {
    await logBot(tenantId, "error", "bybit", `Error en ciclo: ${e.message}`);
  }

  return { actions };
}
