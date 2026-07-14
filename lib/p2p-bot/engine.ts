import { prisma } from "@/lib/prisma";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "./bybit-adapter";
import { BinanceP2PClient } from "./binance-adapter";
import { computeCycleOrderStats } from "./cycle-stats";
import { processChats } from "./chat-agent";
import { initBrowser } from "./chat-playwright";
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
  lastQty: number;
  qtySyncCooldownUntil: number;
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
      lastQty: 0,
      qtySyncCooldownUntil: 0,
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
    priceSource: (config as any).priceSource || "capacity",
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
  exchange: BotExchange,
  label = "ONZE"
): Promise<P2PBotExchangeConfigData | null> {
  const config = await prisma.p2PBotExchangeConfig.findUnique({
    where: { tenantId_exchange_label: { tenantId, exchange, label } },
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
    priceSource: (config as any).priceSource || "capacity",
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
    chatBotEnabled: config.chatBotEnabled ?? false,
    chatCookies: config.chatCookies as string | null,
  };
}

export async function saveExchangeConfig(
  tenantId: number,
  exchange: BotExchange,
  data: Partial<P2PBotExchangeConfigData>,
  label = "ONZE"
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
  if (data.chatBotEnabled !== undefined) update.chatBotEnabled = data.chatBotEnabled;
  if (data.chatCookies !== undefined) update.chatCookies = data.chatCookies;

  await prisma.p2PBotExchangeConfig.upsert({
    where: { tenantId_exchange_label: { tenantId, exchange, label } },
    update,
    create: {
      tenantId,
      label,
      exchange,
      enabled: data.enabled ?? false,
      strategy: data.strategy ?? "top1",
      top1Diff: data.top1Diff ?? 0.1,
      spreadPct: data.spreadPct ?? 0.5,
      priceFloorPct: data.priceFloorPct ?? 0,
      priceSource: data.priceSource ?? "capacity",
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

export async function startExchangeBot(tenantId: number, exchange: BotExchange, label = "ONZE") {
  await saveExchangeConfig(tenantId, exchange, {
    enabled: true,
    pauseUntil: null,
    lastStartedAt: new Date().toISOString(),
  }, label);
  await logBot(tenantId, "info", exchange, `Bot ${exchange} iniciado manualmente`, undefined, label);
  return { ok: true };
}

export async function stopExchangeBot(tenantId: number, exchange: BotExchange, label = "ONZE") {
  await prisma.p2PBotExchangeConfig.update({
    where: { tenantId_exchange_label: { tenantId, exchange, label } },
    data: { enabled: false, lastStoppedAt: new Date() },
  });
  await logBot(tenantId, "info", exchange, `Bot ${exchange} detenido manualmente`, undefined, label);
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
  exchange?: string,
  label?: string
) {
  const where: any = { tenantId };
  if (level) where.level = level;
  if (exchange) where.exchange = exchange;
  if (label) where.label = label;

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
  exchange?: string,
  label?: string
) {
  const where: any = { tenantId };
  if (exchange) where.exchange = exchange;
  if (label) where.label = label;

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
  details?: any,
  label?: string
) {
  try {
    await prisma.p2PBotLog.create({
      data: { tenantId, level, exchange, message, details: details || undefined, label: label || "ONZE" },
    });
  } catch (e: any) {
    console.error("[logBot] Error al escribir log:", e.message);
  }
}

export async function executeBotCycle(tenantId: number, label = "ONZE", force = false) {
  const l = (level: string, exchange: string | null, message: string, details?: any) => logBot(tenantId, level, exchange, message, details, label);
  const config = await getBotConfig(tenantId);
  const isGloballyDisabled = !config || !config.enabled;
  const isPaused =
    !isGloballyDisabled && config.pauseUntil !== null && new Date(config.pauseUntil) > new Date();

  const actions: BotAction[] = [];
  const cycleState: any = {};
  const exchanges = config?.exchanges ?? ["binance", "bybit"];
  let anyEnabled = false;

  for (const exchange of exchanges) {
    try {
      const exchangeConfig = await getExchangeConfig(tenantId, exchange, label);
      const activeConfig = (exchangeConfig || config) as P2PBotExchangeConfigData | P2PBotConfigData;

      // Check if chat should run independently of bot enabled state
      const chatEnabled = exchangeConfig?.chatBotEnabled === true;

      const exPaused =
        !isGloballyDisabled && activeConfig?.pauseUntil !== null &&
        activeConfig?.pauseUntil && new Date(activeConfig.pauseUntil) > new Date();

      const isDisabled = !activeConfig?.enabled || exPaused;
      if (!isDisabled) anyEnabled = true;

      if (isDisabled && !chatEnabled && !force) {
        await l( "info", exchange, `Bot ${exchange} deshabilitado en su sesión`);
        if (exchange === "binance") cycleState.binance = buildBinanceState(getBinanceState(tenantId));
        continue;
      }

      if (exchange === "binance") {
        const creds = await prisma.binanceCredentials.findFirst({
          where: { tenantId, isActive: true, label },
        });
        if (!creds) {
          await l("warn", "binance", "Sin credenciales Binance configuradas");
          cycleState.binance = buildBinanceState(getBinanceState(tenantId));
          continue;
        }

        const binancePromises: Promise<void>[] = [];

        // Run main cycle if bot is enabled, or if force mode (sync button)
        if (!isDisabled || force) {
          binancePromises.push((async () => {
            try {
              const result = await runBinanceCycle(tenantId, activeConfig, creds.apiKey, creds.secretKey, label);
              cycleState.binance = buildBinanceState(getBinanceState(tenantId));
              if (result.actions.length > 0) {
                actions.push(...result.actions);
                await l( "info", "binance", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
              }
            } catch (e: any) {
              cycleState.binance = buildBinanceState(getBinanceState(tenantId));
              await l( "error", "binance", `Error en ciclo Binance: ${e.message}`);
            }
          })());
        }

        // Run chat processing if enabled (even when main bot is disabled)
        if (chatEnabled) {
          binancePromises.push((async () => {
            await l( "info", "binance", "Iniciando processChats...");
            try {
              await initBrowser(tenantId);
              const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
              await processChats(tenantId, "binance", async () => ({ client }), []);
            } catch (e: any) {
              await l( "warn", "binance", `Chat process: ${e.message}`);
            }
          })());
        }

        if (binancePromises.length > 0) await Promise.all(binancePromises);
        if (cycleState.binance === undefined) cycleState.binance = buildBinanceState(getBinanceState(tenantId));
      } else if (exchange === "bybit") {
        const creds = await prisma.bybitCredentials.findFirst({
          where: { tenantId, isActive: true, label },
        });
        if (!creds) {
          await l("warn", "bybit", "Sin credenciales Bybit configuradas");
          continue;
        }

        const bybitPromises: Promise<void>[] = [];

        // Run main cycle if bot is enabled
        if (!isDisabled) {
          bybitPromises.push((async () => {
            try {
              const result = await runBybitCycle(tenantId, activeConfig, creds.apiKey, creds.secretKey, label);
              if (result.actions.length > 0) {
                actions.push(...result.actions);
                await l( "info", "bybit", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
              }
            } catch (e: any) {
              await l( "error", "bybit", e.message || "Error en ciclo Bybit");
            }
          })());
        }

        // Run chat processing if enabled (even when main bot is disabled)
        if (chatEnabled) {
          bybitPromises.push((async () => {
            try {
              const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
              await processChats(tenantId, "bybit", async () => ({ client }), []);
            } catch (e: any) {
              await l( "warn", "bybit", `Chat process: ${e.message}`);
            }
          })());
        }

        if (bybitPromises.length > 0) await Promise.all(bybitPromises);
      } else if (exchange === "okx") {
        if (chatEnabled) {
          await l( "info", "okx", "Chat OKX pendiente de API");
        } else if (!isDisabled) {
          await l( "info", "okx", "OKX integración pendiente de API");
        }
      }
    } catch (e: any) {
      await l( "error", exchange, e.message || "Error en ciclo");
    }
  }

  return { ok: true, actions, state: cycleState, running: anyEnabled };
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

async function getActiveCapacity(prisma: any, tenantId: number) {
  const cap = await prisma.p2PCapacity.findFirst({
    where: { tenantId, status: "active", finishedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return cap;
}

async function autoFinishCapacities(prisma: any, tenantId: number) {
  // Todas las capacities (excepto _capital) ordenadas por creación
  const allCaps = await prisma.p2PCapacity.findMany({
    where: { tenantId, status: { not: "_capital" } },
    orderBy: { createdAt: "asc" },
  });
  const activeCaps = allCaps.filter((c: any) => c.status === "active" && !c.finishedAt);
  if (activeCaps.length === 0) return;

  // Total CLP vendido desde la primera capacity de la historia
  const firstCreatedAt = allCaps[0].createdAt;
  const totalSales = await prisma.binanceOrder.aggregate({
    where: { tenantId, orderStatus: "COMPLETED", tradeType: "SELL", fiat: "CLP", createdAt: { gte: firstCreatedAt } },
    _sum: { totalPrice: true },
  });
  const totalClpEver = Number(totalSales._sum?.totalPrice || 0);

  // Restar lo que las capacities ya finished consumieron
  const consumedAgg = await prisma.p2PCapacity.aggregate({
    where: { tenantId, status: "finished", finalClpReceived: { not: null } },
    _sum: { finalClpReceived: true },
  });
  const alreadyConsumed = Number(consumedAgg._sum?.finalClpReceived || 0);
  let remainingClp = totalClpEver - alreadyConsumed;
  if (remainingClp <= 0) return;

  for (const cap of activeCaps) {
    const capClp = Number(cap.capacityClp);
    if (capClp <= 0) continue;

    const consumed = Math.min(capClp, remainingClp);
    remainingClp -= consumed;

    if (consumed >= capClp) {
      const buyPrice = Number(cap.buyPrice);
      const capUsdt = capClp / (buyPrice || 1);
      await prisma.p2PCapacity.update({
        where: { id: cap.id },
        data: {
          status: "finished",
          finishedAt: new Date(),
          finalSoldUsdt: capUsdt,
          finalClpReceived: capClp,
        },
      });
      await logBot(tenantId, "info", null, `Auto-finish capacity ${buyPrice} (${capClp.toLocaleString("es-CL")} CLP)`);
    } else {
      break;
    }
  }
}

async function runBinanceCycle(
  tenantId: number,
  config: P2PBotConfigData | P2PBotExchangeConfigData,
  apiKey: string,
  secretKey: string,
  label = "ONZE"
): Promise<{ actions: BotAction[] }> {
  const actions: BotAction[] = [];
  const client = new BinanceP2PClient(apiKey, secretKey);
  const bs = getBinanceState(tenantId);
  const log = (level: string, exchange: string | null, message: string, details?: any): Promise<void> =>
    logBot(tenantId, level, exchange, message, details, label);

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
        await log( "debug", "binance", `Respuesta getMyAds: ${JSON.stringify(myAdsRes).slice(0, 500)}`);
      }
    } catch (e: any) {
      await log( "error", "binance", `Error getMyAds: ${e.message}`);
      return { actions };
    }

    // 2. Get managed ads from DB
    let managedAds: any[] = [];
    try {
      managedAds = await prisma.p2PBotAd.findMany({
        where: { tenantId, exchange: "binance", botEnabled: true, label },
      });
      managedAds = managedAds.filter(ma => ma.adId);
      if (managedAds.length === 0) {
        await log( "info", "binance", "Sin anuncios con bot activado");
        return { actions };
      }
    } catch (e: any) {
      await log( "warn", "binance", `Error al leer anuncios: ${e.message}`);
      return { actions };
    }

    // ── Quantity sync: en cada ciclo, compara el saldo real de la wallet contra
    //    la cantidad publicada de cada anuncio gestionado. Si difieren, replica
    //    el botón "TODO" (updateAdQuantity, que ya aplica la fórmula correcta
    //    de initAmount confirmada por soporte de Binance) con el SALDO COMPLETO,
    //    no repartido ni escalonado — así lo confirmó soporte de Binance y así
    //    quedó funcionando (jul 2026). Si falla por 187049 (límite de velocidad
    //    de la cuenta no revelado por Binance), ese anuncio entra en cooldown
    //    para no martillar el mismo salto cada ciclo — solo como red de
    //    seguridad, no cambia el tamaño del salto en sí. Aplica a AMBAS
    //    direcciones: se confirmó que también las bajadas pueden chocar con
    //    187049 (no solo las subidas, como se asumía al principio).
    const QTY_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // tras un 187049, esperar 5 min antes de reintentar ese anuncio
    try {
      if (managedAds.length < 2) {
        await log( "info", "binance", `Sync skip: solo ${managedAds.length} anuncio(s) gestionado(s)`);
      } else {
        const balanceRes = await client.getBalance("USDT");
        const balance = Number(balanceRes?.balance ?? 0);
        if (balance <= 0) {
          await log( "info", "binance", `Sync skip: balance USDT = ${balance}`);
        } else {
          let anyNeeded = false;
          let syncedAny = false;
          for (const ma of managedAds) {
            if (!ma.adId) continue;
            const adInAds = myAds.find((a: any) => a?.id === ma.adId);
            const currQty = Number(adInAds?.lastQuantity ?? adInAds?.quantity ?? 0);
            const needed = balance - currQty;
            if (Math.abs(needed) <= 0.5) continue;
            anyNeeded = true;
            const as = getAdState(bs, ma.adId);
            if (as.qtySyncCooldownUntil > Date.now()) {
              const remainingS = Math.round((as.qtySyncCooldownUntil - Date.now()) / 1000);
              await log( "info", "binance", `Ad ${ma.adId}: sync de cantidad en cooldown (${remainingS}s más) tras 187049 — saltando`);
              continue;
            }
            // 5s de separación entre intentos de sync de cantidad de distintos
            // anuncios en el mismo ciclo (igual que ya existe para precio) —
            // evita mandar varias llamadas de escritura a Binance en ráfaga
            // cuando el saldo cambia de golpe (ej. una orden grande), que es
            // justo el patrón que más choca con el límite de velocidad de
            // cuenta no revelado por Binance (confirmado en vivo: fallo de
            // cantidad y fallo de precio del otro anuncio a 5s de distancia).
            if (syncedAny) {
              await new Promise(r => setTimeout(r, 5000));
            }
            try {
              await client.updateAdQuantity(ma.adId, balance);
              as.qtySyncCooldownUntil = 0;
              await log( "info", "binance", `Ad ${ma.adId}: quantity sync → surplusAmount=${balance} (wallet balance, antes ${currQty})`);
            } catch (e2: any) {
              if (String(e2.message).includes("187049")) {
                as.qtySyncCooldownUntil = Date.now() + QTY_SYNC_COOLDOWN_MS;
              }
              await log( "warn", "binance", `Sync fallo ad ${ma.adId}: ${e2.message}`);
            }
            syncedAny = true;
          }
          if (!anyNeeded) {
            await log( "info", "binance", `Quantity sync: todos los anuncios ya en ${balance} USDT (sin cambios)`);
          }
        }
      }
    } catch (e: any) {
      await log( "warn", "binance", `Error sync cantidad: ${e.message}`);
    }

    // Exchange config fallback values
    const exchangeTop1Diff = Number(config.top1Diff) || 0.1;
    const exchangeCommissionPct = Number((config as any).commissionPct) || 0.14;
    const exchangeSafeMarginPct = Number((config as any).safeMarginPct) || 0;
    const exchangeMinCapital = Number((config as any).minCompetitorCapital) || 0;
    const exchangeCompetePayTypes = (config as any).competePayTypes as string[] | null | undefined;
    const exchangeCircuitBreakPct = Number((config as any).circuitBreakPct) || 3;
    const exchangeDailyVolumeCapUsdt = (config as any).dailyVolumeCapUsdt ? Number((config as any).dailyVolumeCapUsdt) : null;
    const exchangePriceSource = (config as any).priceSource || "capacity";
    const exchangePriceFloorPct = (config as any).priceFloorPct ? Number((config as any).priceFloorPct) : 0;

    // 3. Refresh competitors cache if stale
    const now = Date.now();
    if (now - bs.lastCompetitorFetch > 300 && !bs.isFetching) {
      bs.isFetching = true;
      try {
        // Binance limita este endpoint a 20 filas por página (rechaza más), así
        // que se piden 2 páginas para no perder competidores que queden justo
        // en el borde de la primera — mismo fix aplicado antes al modo
        // "igualar métodos de pago", ahora también acá para el modo general.
        let allRaw: any[] = [];
        const [page1, page2] = await Promise.all([
          client.getOnlineAds({ asset: "USDT", fiat: "CLP", tradeType: "BUY", rows: 20, page: 1, payTypes: [] }),
          client.getOnlineAds({ asset: "USDT", fiat: "CLP", tradeType: "BUY", rows: 20, page: 2, payTypes: [] }),
        ]);
        allRaw = [...(page1?.data ?? []), ...(page2?.data ?? [])];
        await log( "debug", "binance", `Fetch: ${allRaw.length} competidores`);
        if (allRaw.length > 0 || bs.cachedCompetitors.length === 0) {
          bs.cachedCompetitors = allRaw.map(normalizeBinanceAd);
        } else {
          await log( "warn", "binance", `API devolvió 0 competidores, preservando cache anterior (${bs.cachedCompetitors.length} items)`);
        }
        bs.lastCompetitorFetch = Date.now();
        bs.lastCompetitorCount = bs.cachedCompetitors.length;
      } catch (e: any) {
        await log( "warn", "binance", `Fetch competidores: ${e.message}`);
      } finally {
        bs.isFetching = false;
      }
    }

    // Our sell ads
    const ourSellAds = myAds.filter(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );

    // Snapshot all competitors for market data (unfiltered)
    const firstSellAd = ourSellAds[0] || null;
    try {
      const allComps = (bs.cachedCompetitors || []).slice(0, 50).map((c: any) => ({
        id: c.id, nickName: c.nickName, price: Number(c.price),
        minAmount: Number(c.minAmount ?? 0), maxAmount: Number(c.maxAmount ?? 0),
        lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
        orderCount: Number(c.orderCount ?? 0), completionRate: Number(c.completionRate ?? 0),
      }));
      await prisma.p2PBotMarketSnapshot.create({
        data: {
          tenantId,
          exchange: "binance",
          side: "1",
          competitors: JSON.parse(JSON.stringify(allComps)),
          ourAd: firstSellAd ? JSON.parse(JSON.stringify({ id: firstSellAd.id, price: Number(firstSellAd.price), lastQuantity: Number(firstSellAd.lastQuantity ?? firstSellAd.quantity ?? 0) })) : null,
          targetPrice: undefined,
        },
      });
    } catch (e: any) {}

    // Use cached competitors
    const rawCompetitors = bs.cachedCompetitors;

    // Get active capacity (initial read)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      if (activeCap?.buyPrice) activeCapacityBuyPrice = Number(activeCap.buyPrice);
    } catch (e) {}

    // Auto-finish completed capacities
    try {
      await autoFinishCapacities(prisma, tenantId);
    } catch (e: any) {
      await log( "warn", "binance", `Error auto-finish: ${e.message}`);
    }

    // Re-read capacity after auto-finish and update ads with correct price
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      activeCapacityBuyPrice = activeCap?.buyPrice ? Number(activeCap.buyPrice) : null;
      if (activeCapacityBuyPrice && activeCapacityBuyPrice > 0) {
        await prisma.p2PBotAd.updateMany({
          where: { tenantId, exchange: "binance", botEnabled: true, botPriceSource: { not: "manual" } },
          data: { botPriceFloorPct: activeCapacityBuyPrice },
        });
      }
    } catch (e) {}

    // 4. Process each managed ad
    let firstAdPrice = 0;
    let firstAdTarget = 0;
    for (const managedAd of managedAds) {
      const adId = managedAd.adId;
      const ourSellAd = ourSellAds.find((a: any) => String(a.id) === String(adId));
      if (!ourSellAd) {
        await log( "warn", "binance", `Ad ${adId}: no encontrado (se saltó)`);
        continue;
      }
      const currAdQty = Number(ourSellAd.lastQuantity ?? ourSellAd.quantity ?? 0);
      await log( "debug", "binance", `Ad ${adId}: DETALLE ANUNCIO=${JSON.stringify(ourSellAd)}`);
      const currentPrice = Number(ourSellAd.price);
      const as = getAdState(bs, adId);
      if (currAdQty > as.lastQty) as.lastQty = currAdQty;
      if (firstAdPrice === 0) firstAdPrice = currentPrice;

      // Per-ad config — CON herencia del exchange config
      const adTop1Diff = managedAd.botTop1Diff != null ? Number(managedAd.botTop1Diff) : exchangeTop1Diff;
      const adCommissionPct = managedAd.botCommissionPct != null ? Number(managedAd.botCommissionPct) : exchangeCommissionPct;
      const adSafeMarginPct = managedAd.botSafeMarginPct != null ? Number(managedAd.botSafeMarginPct) : exchangeSafeMarginPct;
      await log("debug", "binance", `Ad ${adId}: adSafeMarginPct=${adSafeMarginPct} (ad=${managedAd.botSafeMarginPct} exchange=${exchangeSafeMarginPct})`);
      const adMinCapital = managedAd.botMinCompetitorCapital != null ? Number(managedAd.botMinCompetitorCapital) : exchangeMinCapital;
      let adCompetePayTypes = managedAd.botCompetePayTypes != null ? (managedAd.botCompetePayTypes as string[] | null | undefined) : exchangeCompetePayTypes;
      if (adCompetePayTypes && adCompetePayTypes[0] === 'all') {
        adCompetePayTypes = null;
      } else if (!adCompetePayTypes || !adCompetePayTypes.length) {
        adCompetePayTypes = null;
      }
      const adPriceSource = managedAd.botPriceSource || exchangePriceSource;
      const adPriceFloorPct = managedAd.botPriceFloorPct != null ? Number(managedAd.botPriceFloorPct) : (exchangePriceFloorPct > 0 ? exchangePriceFloorPct : null);
      const adCircuitBreakPct = managedAd.botCircuitBreakPct != null ? Number(managedAd.botCircuitBreakPct) : exchangeCircuitBreakPct;
      const adDailyVolumeCapUsdt = managedAd.botDailyVolumeCapUsdt != null ? Number(managedAd.botDailyVolumeCapUsdt) : exchangeDailyVolumeCapUsdt;

      let minSellPrice = 0;
      // 1) Per-ad price floor override (solo si source es manual)
      if (adPriceSource === "manual" && adPriceFloorPct != null && adPriceFloorPct > 0) minSellPrice = adPriceFloorPct;
      // 2) Si no hay manual, usar capacity activa
      if (minSellPrice <= 0 && activeCapacityBuyPrice) minSellPrice = activeCapacityBuyPrice;
      if (minSellPrice <= 0) {
        await log( "warn", "binance", `Ad ${adId}: sin precio mínimo`);
        continue;
      }
      const priceFloor = minSellPrice * (1 + adCommissionPct / 100);

      // Filter competitors for this ad
      let competitors: any[];
      let needsPaymentFilter = true;

      // For __match_ad__, fetch directly from API with payTypes filter (fast, 2 páginas).
      // Binance rechaza rows > 20 por página ("illegal parameter") — no se puede pedir
      // más de una vez, hay que pedir la página 2 aparte y combinar, para no perder
      // competidores que queden justo en el borde de la página 1.
      if (adCompetePayTypes?.[0] === "__match_ad__") {
        const ids = (ourSellAd?.payments || []).map((p: any) => String(p));
        const names = (ourSellAd?.paymentMethods || []).map((p: any) => String(p));
        const payTypes = [...new Set([...ids, ...names])];
        if (payTypes.length > 0) {
          try {
            const [page1, page2] = await Promise.all([
              client.getOnlineAds({ asset: "USDT", fiat: "CLP", tradeType: "BUY", rows: 20, page: 1, payTypes }),
              client.getOnlineAds({ asset: "USDT", fiat: "CLP", tradeType: "BUY", rows: 20, page: 2, payTypes }),
            ]);
            const combined = [...(page1?.data ?? []), ...(page2?.data ?? [])];
            competitors = combined.map(normalizeBinanceAd);
            needsPaymentFilter = false;
            await log( "debug", "binance", `Ad ${adId}: API filtrada devolvió ${competitors.length} competidores con payTypes=${JSON.stringify(payTypes)}`);
          } catch (e: any) {
            await log( "warn", "binance", `Ad ${adId}: error API filtrada, usando cache: ${e.message}`);
            competitors = [...rawCompetitors];
          }
        } else {
          competitors = [...rawCompetitors];
        }
      } else {
        competitors = [...rawCompetitors];
      }

      // Post-filter payment methods (only if not already filtered at API level)
      if (needsPaymentFilter) {
        let ourPayMethods: string[] | undefined;
        let rawPayTypes = adCompetePayTypes;
        if (typeof rawPayTypes === "string") {
          if (rawPayTypes === "all" || rawPayTypes === "*") rawPayTypes = null;
        }
        if (rawPayTypes && rawPayTypes.length > 0 && rawPayTypes[0] !== "*") {
          if (rawPayTypes[0] === "__match_ad__") {
            const ids = (ourSellAd?.payments || []).map((p: any) => String(p));
            const names = (ourSellAd?.paymentMethods || []).map((p: any) => String(p));
            ourPayMethods = [...new Set([...ids, ...names])];
          } else if (Array.isArray(rawPayTypes)) {
            ourPayMethods = rawPayTypes;
          }
          if (ourPayMethods && ourPayMethods.length > 0) {
            const beforeCount = competitors.length;
            const paySamples = competitors.slice(0, 5).map((c: any) => ({ id: c.id?.slice(-4), price: c.price, pay: c.payments, pm: c.paymentMethods }));
            competitors = competitors.filter((c: any) => {
              const cmpAll = [
                ...(c.payments || []).map((p: any) => String(p)),
                ...(c.paymentMethods || []).map((p: any) => String(p)),
              ];
              return cmpAll.some((p: string) => ourPayMethods!.includes(p));
            });
            const afterCount = competitors.length;
            if (afterCount === 0) {
              await log( "warn", "binance", `Ad ${adId}: filtro pago eliminó ${beforeCount} competidores. ourPayMethods=${JSON.stringify(ourPayMethods)} samples=${JSON.stringify(paySamples)}`);
            }
          }
        }
      }
      if (competitors.length === 0) {
        await log( "warn", "binance", `Ad ${adId}: sin competidores tras filtro`);
        continue;
      }

      // Viability filters
      const viable = competitors.filter((c: any) => {
        if (Number(c.price) < minSellPrice) return false;
        if (c.userType && c.userType !== "merchant") return false;
        if (adMinCapital > 0) {
          const cap = Number(c.lastQuantity ?? c.surplusAmount ?? c.tradableQuantity ?? c.quantity ?? 0);
          if (cap < adMinCapital) return false;
        }
        return true;
      });
      // Si no hay ningún competidor viable (ej: todo el mercado está por debajo de
      // nuestro costo real), el anuncio NUNCA debe quedarse fijo en el precio que
      // tenía — debe caer directo al piso de seguridad (el precio más competitivo
      // posible sin vender bajo costo). No hay "continue" acá: se deja que el
      // cálculo de más abajo caiga en el default (safeFloor) al no encontrar
      // targetCompetitor.
      if (viable.length === 0) {
        await log( "debug", "binance", `Ad ${adId}: viable vacío — ${competitors.length} competidores tras filtro pago, minSellPrice=${minSellPrice}, adMinCapital=${adMinCapital} — cayendo al piso de seguridad`);
      }

      viable.sort((a: any, b: any) => Number(a.price) - Number(b.price));
      const myAdIds = new Set(myAds.map((a: any) => a.id));
      const sortedCompetitors = viable.filter((c: any) => !myAdIds.has(c.id));
      if (sortedCompetitors.length === 0 && viable.length > 0) {
        await log( "debug", "binance", `Ad ${adId}: sortedCompetitors vacío — ${viable.length} viables, todos eran propios — cayendo al piso de seguridad`);
      }

      // Safe margin filter
      const viableCompetitors: any[] = [];
      for (let i = 0; i < sortedCompetitors.length; i++) {
        const comp = sortedCompetitors[i];
        const marginPct = priceFloor > 0 ? ((Number(comp.price) - priceFloor) / priceFloor) * 100 : 999;
        if (marginPct >= adSafeMarginPct) viableCompetitors.push(comp);
      }

      // Safe margin floor (basado en costo real + margen de seguridad)
      const safeFloor = minSellPrice * (1 + (adCommissionPct + adSafeMarginPct) / 100);
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

      // Sin competidor objetivo (nadie viable, ej: mercado completo por debajo de
      // nuestro costo) → el anuncio cae al piso de seguridad, nunca se queda fijo
      // en el precio anterior.
      let targetPrice = targetCompetitor ? Number(targetCompetitor.price) - adTop1Diff : safeFloor;
      // Nunca quedarse debajo del precio mínimo de seguridad
      if (targetPrice < safeFloor) { targetPrice = safeFloor; }
      if (firstAdTarget === 0) firstAdTarget = targetPrice;

      const diff = Math.abs(currentPrice - targetPrice);
      await log( "debug", "binance", `Ad ${adId}: currentPrice=${currentPrice} targetPrice=${targetPrice} diff=${diff} isPriceUp=${targetPrice > currentPrice} minSellPrice=${minSellPrice} priceFloor=${priceFloor} safeFloor=${safeFloor} adMinCapital=${adMinCapital}`);
      if (diff < 0.005) {
        await log( "debug", "binance", `Ad ${adId}: diff ${diff} < 0.005, saltando`);
        continue;
      }

      // ── Price recovery check (targetPrice > currentPrice) ──
      const isPriceUp = targetPrice > currentPrice;
      if (isPriceUp) {
        const oneHourAgo = Date.now() - 3600000;
        as.priceUpTimestamps = as.priceUpTimestamps.filter(t => t > oneHourAgo);
        as.currentWeight = Math.max(as.currentWeight, client.latestWeight);

        if (as.currentWeight >= 4000) {
          await log( "warn", "binance", `Ad ${adId}: weight ${as.currentWeight} ≥ 4000, pausando subida`);
          continue;
        }
        if (as.lastRateLimitError > 0 && Date.now() - as.lastRateLimitError < as.rateLimitBackoffMs) {
          const remainingS = Math.round((as.rateLimitBackoffMs - (Date.now() - as.lastRateLimitError)) / 1000);
          await log( "warn", "binance", `Ad ${adId}: cooldown activo (${remainingS}s más), saltando subida`);
          continue;
        }
        if (as.priceUpTimestamps.length >= 80) {
          await log( "warn", "binance", `Ad ${adId}: límite 80 subidas/hora alcanzado, saltando`);
          continue;
        }
        if (as.lastPriceUpAt > 0 && (Date.now() - as.lastPriceUpAt < 300)) {
          await log( "debug", "binance", `Ad ${adId}: gap subida <300ms, esperando`);
          continue;
        }
      } else {
        as.currentWeight = Math.max(as.currentWeight, client.latestWeight);
        const oneHourAgo = Date.now() - 3600000;
        as.updateTimestamps = as.updateTimestamps.filter(t => t > oneHourAgo);

        if (as.updateTimestamps.length >= 3600) {
          await log( "warn", "binance", `Ad ${adId}: límite 3600/hr alcanzado (${as.updateTimestamps.length}), saltando`);
          continue;
        }
        if (as.lastUpdateAt > 0 && (Date.now() - as.lastUpdateAt < 300)) {
          await log( "debug", "binance", `Ad ${adId}: gap <300ms desde último update, esperando`);
          continue;
        }
        if (as.currentWeight >= 4000) {
          await log( "warn", "binance", `Ad ${adId}: weight ${as.currentWeight} ≥ 4000, pausando`);
          continue;
        }
        if (as.lastRateLimitError > 0 && Date.now() - as.lastRateLimitError < as.rateLimitBackoffMs) {
          const remainingS = Math.round((as.rateLimitBackoffMs - (Date.now() - as.lastRateLimitError)) / 1000);
          await log( "warn", "binance", `Ad ${adId}: cooldown rate-limit (${remainingS}s más), saltando`);
          continue;
        }
      }

      // ── Execute price-only update ──
      // updateAd() reads the ad's full config and resends it unchanged except
      // for price — required so Binance's full-config validation doesn't 187049.
      try {
        const payload: any = { adId, price: targetPrice.toFixed(2) };
        await log( "info", "binance",
          `Ad ${adId}: price update → price=${targetPrice.toFixed(2)}`);
        await client.updateAd(payload);
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
          await log( "info", "binance", `Ad ${adId}: ${currentPrice} → ${targetPrice.toFixed(2)} (${as.priceUpTimestamps.length}/80 subidas esta hora)`);
        } else {
          await log( "info", "binance", `Ad ${adId}: ${currentPrice} → ${targetPrice.toFixed(2)} (${as.updateTimestamps.length}/30 esta hora)`);
        }
      } catch (e: any) {
        if (e.message?.includes("187049") || e.message?.includes("187040")) {
          await log( "warn", "binance",
            `Ad ${adId}: error 187049 en price-only update — esperando 10s y reintentando una vez...`);
          await new Promise(r => setTimeout(r, 10000));
          try {
            const retryPayload: any = { adId, price: targetPrice.toFixed(2) };
            await log( "info", "binance",
              `Ad ${adId}: retry tras 10s → price=${targetPrice.toFixed(2)}`);
            await client.updateAd(retryPayload);
            as.lastUpdateAt = Date.now();
            as.rateLimitBackoffMs = 0;
            if (isPriceUp) {
              as.priceUpTimestamps.push(Date.now());
              as.lastPriceUpAt = Date.now();
            } else {
              as.updateTimestamps.push(Date.now());
            }
            actions.push({ action: "update_price", exchange: "binance", adId, currentPrice, suggestedPrice: targetPrice, reason: `187049→retry: ${currentPrice} → ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
            await log( "info", "binance", `Ad ${adId}: retry OK — ${currentPrice} → ${targetPrice.toFixed(2)}`);
          } catch (e2: any) {
            as.lastRateLimitError = Date.now();
            as.rateLimitBackoffMs = 5 * 60 * 1000;
            await log( "warn", "binance",
              `Ad ${adId}: retry tras 10s también falló: ${e2.message} — en cooldown 5 min antes de reintentar`);
          }
        } else if (e.message?.includes("187055")) {
          const rangeMatch = e.message.match(/\[([\d.]+)\s*-\s*([\d.]+)\]/);
          if (rangeMatch) {
            const rangeMin = parseFloat(rangeMatch[1]);
            const rangeMax = parseFloat(rangeMatch[2]);
            const belowRange = rangeMin - 0.01;
            const aboveRange = rangeMax + 0.01;
            let candidates = [];
            if (belowRange >= safeFloor) candidates.push(belowRange);
            if (aboveRange > currentPrice) candidates.push(aboveRange);
            candidates.sort((a, b) => Math.abs(a - targetPrice) - Math.abs(b - targetPrice));
            let fallbackPrice: number | null = null;
            for (const c of candidates) {
              if (Math.abs(c - currentPrice) >= 0.005) { fallbackPrice = c; break; }
            }
            if (fallbackPrice !== null) {
              await log( "warn", "binance", `Ad ${adId}: rango ocupado [${rangeMin}-${rangeMax}], intentando ${fallbackPrice.toFixed(2)}`);
              try {
                const pf: any = { adId, price: fallbackPrice.toFixed(2) };
                await log( "info", "binance",
                  `Ad ${adId}: price update → price=${fallbackPrice.toFixed(2)}`);
                await client.updateAd(pf);
                as.lastUpdateAt = Date.now();
                actions.push({ action: "update_price", exchange: "binance", adId, currentPrice, suggestedPrice: fallbackPrice, reason: `Rango避开 [${rangeMin}-${rangeMax}] → ${fallbackPrice.toFixed(2)}`, timestamp: Date.now() });
                await log( "info", "binance", `Ad ${adId}: ${currentPrice} → ${fallbackPrice.toFixed(2)} (rango evitado)`);
              } catch (e2: any) {
                await log( "warn", "binance", `Ad ${adId}: fallback también falló: ${e2.message}`);
              }
            } else {
              await log( "warn", "binance", `Ad ${adId}: rango ocupado [${rangeMin}-${rangeMax}], sin precio alternativo viable, saltando`);
            }
          } else {
            await log( "warn", "binance", `Ad ${adId}: error 187055 (rango ocupado), no se pudo parsear rango, saltando`);
          }
        } else if (e.message?.includes("83229") || e.message?.includes("83230")) {
          await log( "warn", "binance", `Ad ${adId}: ad offline (${e.message}), saltando`);
        } else {
          await log( "warn", "binance",
            `Ad ${adId}: error update — reintentando próximo ciclo: ${e.message}`);
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
        const orderId = o.orderNumber ?? o.orderNo ?? o.id;
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
              counterparty: o.counterPartNickName ?? o.counterpartyNickName ?? o.publisherName ?? "",
              executedAt: o.createTime ? new Date(o.createTime) : new Date(),
            },
          });
        }
      }
    } catch (e: any) {
      if (!e.message?.includes("-9000") && !e.message?.includes("-1000")) {
        await log( "warn", "binance", `Error órdenes: ${e.message}`);
      }
    }

    // Update stored price/target for UI
    await log( "info", "binance", `Ciclo completado: managedAds: ${managedAds.length}`);

    try {
      await autoCloseCycle(prisma, tenantId, label, client, log);
    } catch (e: any) {
      await log( "warn", "binance", `Auto-close cycle check: ${e.message}`);
    }
  } catch (e: any) {
    await log( "error", "binance", `Error en ciclo: ${e.message}`);
  }

  return { actions };
}

const bybitLastUpdateAt = new Map<string, number>();
const bybitModCount = new Map<string, number>();
const bybitAdCache = new Map<string, any>();

async function runBybitCycle(
  tenantId: number,
  config: P2PBotConfigData | P2PBotExchangeConfigData,
  apiKey: string,
  secretKey: string,
  label = "ONZE"
): Promise<{ actions: BotAction[] }> {
  const actions: BotAction[] = [];
  const client = new BybitP2PClient(apiKey, secretKey);
  const log = (level: string, exchange: string | null, message: string, details?: any): Promise<void> =>
    logBot(tenantId, level, exchange, message, details, label);

  try {
    // 1. Get our current balance (non-critical, continue if fails)
    let bybitBalance = 0;
    try {
      const balanceRes = await client.getBalance("USDT");
      const usdtCoin = balanceRes?.result?.balance?.find((c: any) => c.coin === "USDT");
      bybitBalance = usdtCoin ? Number(usdtCoin.walletBalance) : 0;
      await log( "info", "bybit", `Saldo USDT: ${bybitBalance}`);
    } catch (e: any) {
      await log( "warn", "bybit", `Balance no disponible: ${e.message}`);
    }

    // 2. Get our current ads from Bybit
    let myAds: any[] = [];
    try {
      const myAdsRes = await client.getMyAds(1, 50);
      myAds = myAdsRes?.result?.items || [];
    } catch (e: any) {
      await log( "error", "bybit", `Error getMyAds: ${e.message}`);
      throw e;
    }

    // 3. Get all bot-enabled ads from DB
    let managedAds: any[] = [];
    try {
      managedAds = await prisma.p2PBotAd.findMany({
        where: { tenantId, exchange: "bybit", botEnabled: true, label },
      });
      managedAds = managedAds.filter(ma => ma.adId);
      if (managedAds.length === 0) {
        await log( "info", "bybit", "Sin anuncios con bot activado. Actívalo en cada anuncio desde el panel.");
        return { actions };
      }
    } catch (e: any) {
      await log( "warn", "bybit", `Error al leer anuncios gestionados: ${e.message}`);
      return { actions };
    }

    // Bybit exchange config fallbacks
    const exchangeTop1Diff = Number(config.top1Diff) || 0.1;
    const exchangeSafeMarginPct = Number((config as any).safeMarginPct) || 0;
    const exchangeMinCapital = Number((config as any).minCompetitorCapital) || 0;
    const exchangePriceSource = (config as any).priceSource || "capacity";
    const exchangePriceFloorPct = (config as any).priceFloorPct ? Number((config as any).priceFloorPct) : 0;

    // Our sell ads
    const ourSellAds = myAds.filter(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );

    // 4. Get online competitor ads (once, with pagination)
    let rawCompetitors: any[] = [];
    try {
      for (let page = 1; page <= 1; page++) {
        const pageRes = await client.getOnlineAds({
          tokenId: "USDT",
          currencyId: "CLP",
          side: "1",
          page: String(page),
          size: "100",
        });
        const pageData = pageRes?.result?.items || [];
        if (pageData.length > 0) rawCompetitors = rawCompetitors.concat(pageData);
      }
    } catch (e: any) {
      await log( "error", "bybit", `Error getOnlineAds: ${e.message}`);
      throw e;
    }
    await log( "info", "bybit", `OnlineAds: ${rawCompetitors.length} items`);

    // Snapshot all competitors for market data (unfiltered)
    const firstSellAd = ourSellAds[0] || null;
    try {
      const allComps = (rawCompetitors || []).slice(0, 50).map((c: any) => ({
        id: c.id, nickName: c.nickName, price: Number(c.price),
        minAmount: Number(c.minAmount ?? 0), maxAmount: Number(c.maxAmount ?? 0),
        lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
        orderCount: Number(c.orderCount ?? 0), completionRate: Number(c.completionRate ?? 0),
      }));
      await prisma.p2PBotMarketSnapshot.create({
        data: {
          tenantId,
          exchange: "bybit",
          side: "1",
          competitors: JSON.parse(JSON.stringify(allComps)),
          ourAd: firstSellAd ? JSON.parse(JSON.stringify({ id: firstSellAd.id, price: Number(firstSellAd.price), lastQuantity: Number(firstSellAd.lastQuantity ?? firstSellAd.quantity ?? 0) })) : null,
          targetPrice: undefined,
        },
      });
    } catch (e: any) {}

    // Get active capacity (initial read)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      if (activeCap?.buyPrice) activeCapacityBuyPrice = Number(activeCap.buyPrice);
    } catch (e) {}

    // Auto-finish completed capacities
    try {
      await autoFinishCapacities(prisma, tenantId);
    } catch (e: any) {
      await log( "warn", "bybit", `Error auto-finish: ${e.message}`);
    }

    // Re-read capacity after auto-finish and update ads with correct price
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      activeCapacityBuyPrice = activeCap?.buyPrice ? Number(activeCap.buyPrice) : null;
      if (activeCapacityBuyPrice && activeCapacityBuyPrice > 0) {
        await prisma.p2PBotAd.updateMany({
          where: { tenantId, exchange: "bybit", botEnabled: true, botPriceSource: { not: "manual" } },
          data: { botPriceFloorPct: activeCapacityBuyPrice },
        });
      }
    } catch (e) {}

    // 5. Process each managed ad independently
    for (const managedAd of managedAds) {
      const adId = managedAd.adId;
      let ourSellAd = ourSellAds.find((a: any) => String(a.id) === String(adId));
      if (!ourSellAd) {
        const cached = bybitAdCache.get(adId);
        if (cached) {
          ourSellAd = cached;
          await log( "info", "bybit", `Ad ${adId}: usando datos cacheados (recreación reciente)`);
        } else {
          await log( "warn", "bybit", `Ad ${adId}: no encontrado en myAds`);
          continue;
        }
      } else {
        bybitAdCache.delete(adId);
      }
      const currentPrice = Number(ourSellAd.price);

      // Per-ad config — CON herencia del exchange config
      const adTop1Diff = managedAd.botTop1Diff != null ? Number(managedAd.botTop1Diff) : exchangeTop1Diff;
      const adSafeMarginPct = managedAd.botSafeMarginPct != null ? Number(managedAd.botSafeMarginPct) : exchangeSafeMarginPct;
      const adMinCapital = managedAd.botMinCompetitorCapital != null ? Number(managedAd.botMinCompetitorCapital) : exchangeMinCapital;
      const adPriceSource = managedAd.botPriceSource || exchangePriceSource;
      const adPriceFloorPct = managedAd.botPriceFloorPct != null ? Number(managedAd.botPriceFloorPct) : (exchangePriceFloorPct > 0 ? exchangePriceFloorPct : null);

      // Min sell price
      let minSellPrice = 0;
      if (adPriceSource === "manual" && adPriceFloorPct != null && adPriceFloorPct > 0) minSellPrice = adPriceFloorPct;
      if (minSellPrice <= 0 && activeCapacityBuyPrice) minSellPrice = activeCapacityBuyPrice;
      if (minSellPrice <= 0) {
        await log( "warn", "bybit", `Ad ${adId}: sin precio mínimo`);
        continue;
      }
      await log( "info", "bybit", `Ad ${adId}: minSell=${minSellPrice}, top1Diff=${adTop1Diff}, safeMargin=${adSafeMarginPct}%`);

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
        await log( "info", "bybit", `Ad ${adId}: sin competidores viables`);
        continue;
      }
      competitors.sort((a: any, b: any) => Number(a.price) - Number(b.price));

      const myAdIds = new Set(myAds.map((a: any) => a.id));
      const sortedCompetitors = competitors.filter((c: any) => !myAdIds.has(c.id));
      if (sortedCompetitors.length === 0) {
        await log( "info", "bybit", `Ad ${adId}: solo nuestros anuncios`);
        continue;
      }

      // Safe margin floor (incluye margen de seguridad)
      const safeFloor = minSellPrice * (1 + adSafeMarginPct / 100);

      // Safe margin filter — solo competidores sobre safeFloor
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
              await log( "warn", "bybit", `Ad ${adId}: sin margen/piso, usando más cercano sobre precio: ${Number(targetCompetitor.price).toFixed(2)}`);
              break;
            }
          }
        }
      }

      let targetPrice = currentPrice;
      if (targetCompetitor) {
        await log( "info", "bybit", `Ad ${adId}: target #${targetIndex + 1}: ${Number(targetCompetitor.price).toFixed(2)}`);
        const targetRaw = Number(targetCompetitor.price) - adTop1Diff;
        if (targetRaw > safeFloor) {
          targetPrice = targetRaw;
        } else {
          await log( "warn", "bybit", `Ad ${adId}: target bajo piso de seguridad, manteniendo ${currentPrice.toFixed(2)}`);
        }
      } else {
        await log( "warn", "bybit", `Ad ${adId}: sin target sobre piso de seguridad, manteniendo ${currentPrice.toFixed(2)}`);
      }
      // Nunca quedarse debajo del safeFloor
      if (targetPrice < safeFloor) { targetPrice = Math.max(currentPrice, safeFloor); }

      // Rate limit protection solo tras rate-limit real (recreación), no en updates normales
      const lastUpdateKey = `bybit:${adId}`;
      const cooldownUntil = bybitLastUpdateAt.get(lastUpdateKey);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        await log( "debug", "bybit", `Ad ${adId}: cooldown activo, saltando (${((cooldownUntil - Date.now()) / 1000).toFixed(0)}s restantes)`);
        continue;
      }

      // Update ad
      let fullAd: any = ourSellAd;
      let paymentIds: string[] = [];
      let strTps: any = {};
      const modKey = `bybit:mods:${adId}`;
      const currentMods = bybitModCount.get(modKey) ?? 0;
      let updateFields: any = null;
      try {
          // Use data from getMyAds; getAdDetail is redundant slow API call
          const payObjs = fullAd.paymentTerms ?? fullAd.payments ?? [];
          paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];
          const tps = fullAd.tradingPreferenceSet ?? {};
          for (const k of Object.keys(tps)) strTps[k] = String(tps[k] ?? "");

          const adQuantity = String(fullAd.lastQuantity ?? fullAd.quantity ?? "0");
          const adMaxAmount = String(fullAd.maxAmount ?? "0");
          const rawMin = String(fullAd.minAmount ?? "0");
          const cappedMin = Number(rawMin) > Number(adMaxAmount) ? adMaxAmount : rawMin;
          const updateQuantity = adQuantity;
          updateFields = {
            id: adId,
            price: targetPrice.toFixed(2),
            actionType: "MODIFY",
            priceType: String(fullAd.priceType ?? "0"),
            premium: String(fullAd.premium ?? "0"),
            quantity: updateQuantity,
            minAmount: cappedMin,
            maxAmount: adMaxAmount,
            paymentPeriod: String(fullAd.paymentPeriod ?? "15"),
            paymentIds,
            remark: String(fullAd.remark ?? ""),
            tradingPreferenceSet: strTps,
          };
          // Recreate at mod 9 (before hitting Bybit's 10-mod limit)
          if (currentMods >= 9) {
            await log( "info", "bybit", `Ad ${adId}: ${currentMods} modificaciones, recreando...`);
            const recreatePrice = currentPrice + 0.50;
            try { await client.updateAd({ id: adId, status: 20 }); } catch {}
            await new Promise(r => setTimeout(r, 1000));
            let removed = false;
            for (let retry = 0; retry < 3; retry++) {
              try { await client.removeAd(adId); removed = true; break; }
              catch (removeErr: any) {
                await log( "warn", "bybit", `Ad ${adId}: remove intento ${retry + 1} falló: ${removeErr.message}`);
                if (retry < 2) await new Promise(r => setTimeout(r, 2000));
              }
            }
            if (!removed) {
              await log( "error", "bybit", `Ad ${adId}: no se pudo eliminar, abortando recreación`);
            } else {
              await new Promise(r => setTimeout(r, 3000));
              const postFields: any = {
                tokenId: "USDT", currencyId: "CLP", side: "1",
                price: recreatePrice.toFixed(2),
                priceType: String(fullAd.priceType ?? "0"),
                premium: String(fullAd.premium ?? "0"),
                quantity: String(fullAd.lastQuantity ?? fullAd.quantity ?? "0"),
                minAmount: String(fullAd.minAmount ?? "0"),
                maxAmount: String(fullAd.maxAmount ?? "0"),
                paymentPeriod: String(fullAd.paymentPeriod ?? "15"),
                paymentIds, remark: String(fullAd.remark ?? ""),
                tradingPreferenceSet: strTps,
                itemType: String(fullAd.itemType ?? "ORIGIN"), status: 10,
              };
              let createdId: string | null = null;
              const extractAdId = (res: any) =>
                res?.result?.itemId ?? res?.result?.item?.id ?? res?.result?.id;
              try {
                const newAdRes = await client.postAd(postFields);
                createdId = extractAdId(newAdRes);
                if (!createdId) {
                  await log( "warn", "bybit", `Ad ${adId}: postAd OK pero no se pudo extraer ID (respuesta: ${JSON.stringify(newAdRes).slice(0, 300)})`);
                }
              } catch (e2: any) {
                if (e2.message?.includes("90043")) {
                  const retryPrice = Math.max(recreatePrice * 1.005, minSellPrice * 1.005);
                  postFields.price = retryPrice.toFixed(2);
                  try {
                    const retryRes = await client.postAd(postFields);
                    createdId = extractAdId(retryRes);
                    if (!createdId) {
                      await log( "warn", "bybit", `Ad ${adId}: postAd retry OK pero no se pudo extraer ID`);
                    }
                  } catch {
                    await log( "error", "bybit", `Ad ${adId}: postAd retry falló incluso con precio ajustado`);
                  }
                } else {
                  await log( "warn", "bybit", `Ad ${adId}: error al recrear: ${e2.message}`);
                }
              }
              if (createdId) {
                await new Promise(r => setTimeout(r, 2000));
                try { await client.updateAd({ id: String(createdId), status: 10 }); } catch {}
                bybitModCount.set(modKey, 0);
                await prisma.p2PBotAd.update({ where: { id: managedAd.id }, data: { adId: String(createdId) } });
                bybitAdCache.set(String(createdId), {
                  id: String(createdId), price: String(recreatePrice),
                  side: 1, tokenId: "USDT", currencyId: "CLP",
                  priceType: fullAd.priceType, premium: fullAd.premium,
                  lastQuantity: fullAd.lastQuantity, quantity: fullAd.quantity,
                  minAmount: fullAd.minAmount, maxAmount: fullAd.maxAmount,
                  paymentPeriod: fullAd.paymentPeriod,
                  payments: fullAd.payments, paymentTerms: fullAd.paymentTerms,
                  remark: fullAd.remark, tradingPreferenceSet: fullAd.tradingPreferenceSet,
                  itemType: fullAd.itemType,
                });
                bybitAdCache.delete(adId);
                await log( "info", "bybit", `Anuncio recreado como ${createdId} (precio: ${recreatePrice.toFixed(2)})`);
                actions.push({ action: "recreate_ad", exchange: "bybit", adId: createdId, suggestedPrice: recreatePrice, reason: `Recreado (${currentMods} mods)`, timestamp: Date.now() });
                // Skip normal update below — ya recreamos
              } else {
                await log( "error", "bybit", `Ad ${adId}: recreación fallida, el anuncio viejo fue eliminado pero no se creó reemplazo`);
              }
            }
          } else {
            await client.updateAd(updateFields);
            bybitModCount.set(modKey, currentMods + 1);
            actions.push({ action: "update_price", exchange: "bybit", adId, currentPrice, suggestedPrice: targetPrice, reason: `Ad ${adId} actualizado a ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
            await log( "info", "bybit", `Ad ${adId} precio actualizado: ${currentPrice} → ${targetPrice.toFixed(2)} (mod #${currentMods + 1})`);
          }
        } catch (e: any) {
          if (e.message?.includes("912120050")) {
            await log( "info", "bybit", `Rate limit, recreando anuncio ${adId} en 5s...`);
            await new Promise(r => setTimeout(r, 5000));
            let removed = false;
            for (let retry = 0; retry < 3; retry++) {
              try {
                await client.removeAd(adId);
                removed = true;
                break;
              } catch (removeErr: any) {
                await log( "warn", "bybit", `Ad ${adId}: remove intento ${retry + 1} falló: ${removeErr.message}`);
                if (retry < 2) await new Promise(r => setTimeout(r, 2000));
              }
            }
            if (!removed) {
              await log( "error", "bybit", `Ad ${adId}: no se pudo eliminar tras rate limit, abortando recreación`);
            } else {
            await new Promise(r => setTimeout(r, 3000));
            const recreatePrice = targetPrice;
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
                  await log( "info", "bybit", `Anuncio ${newAdId} creado y activado online`);
                } catch (e3: any) {
                  await log( "warn", "bybit", `Anuncio ${newAdId}: no se pudo activar online (${e3.message}), reintentando próximo ciclo`);
                }
                bybitModCount.set(modKey, 0);
                bybitLastUpdateAt.set(lastUpdateKey, Date.now() + 120000);
                actions.push({ action: "recreate_ad", exchange: "bybit", adId: newAdId, suggestedPrice: targetPrice, reason: `Nuevo anuncio creado tras rate-limit`, timestamp: Date.now() });
                await prisma.p2PBotAd.update({
                  where: { id: managedAd.id },
                  data: { adId: String(newAdId) },
                });
                await log( "info", "bybit", `Anuncio recreado como ${newAdId}`);
              }
              } catch (e2: any) {
              if (e2.message?.includes("90043")) {
                // Price too close — retry with 0.5% higher difference
                const retryPrice = Math.max(currentPrice * 1.005, minSellPrice * 1.005);
                postFields.price = retryPrice.toFixed(2);
                try {
                  const retryRes = await client.postAd(postFields);
                  const retryId = retryRes?.result?.item?.id ?? retryRes?.result?.id;
                    if (retryId) {
                      await new Promise(r => setTimeout(r, 2000));
                      try { await client.updateAd({ id: String(retryId), status: 10 }); } catch {}
                      bybitModCount.set(modKey, 0);
                      bybitLastUpdateAt.set(lastUpdateKey, Date.now() + 120000);
                      await prisma.p2PBotAd.update({
                        where: { id: managedAd.id },
                        data: { adId: String(retryId) },
                      });
                      await log( "info", "bybit", `Anuncio recreado como ${retryId} (precio ajustado: ${retryPrice.toFixed(2)})`);
                    }
                } catch {}
              } else {
                await log( "warn", "bybit", `Ad ${adId}: error al recrear: ${e2.message}`);
              }
            }
            } // cierra else del if(!removed)
          } else if (e.message?.includes("912120031")) {
            await log( "info", "bybit", `Ad ${adId} offline, reactivando para próximo ciclo...`);
            try {
              await client.updateAd({ id: adId, status: 10 } as any);
              await log( "info", "bybit", `Ad ${adId} reactivado`);
            } catch(e2: any) {
              await log( "warn", "bybit", `Ad ${adId}: no se pudo reactivar: ${e2.message}`);
            }
          } else if (e.message?.includes("90043")) {
            let adjustPrice = targetPrice > currentPrice ? targetPrice * 1.005 : targetPrice * 0.995;
            if (adjustPrice < minSellPrice) adjustPrice = minSellPrice * 1.005;
            await log( "info", "bybit", `Ad ${adId}: 90043, reintentando con ajuste >0.5% (${adjustPrice.toFixed(2)})`);
            try {
              await client.updateAd({ ...updateFields, price: adjustPrice.toFixed(2) });
              bybitModCount.set(modKey, currentMods + 1);
              actions.push({ action: "update_price", exchange: "bybit", adId, currentPrice, suggestedPrice: adjustPrice, reason: `Ad ${adId} forzado a ${adjustPrice.toFixed(2)}`, timestamp: Date.now() });
            } catch(e2: any) {
              await log( "warn", "bybit", `Ad ${adId}: error post-90043: ${e2.message}`);
            }
          } else {
            await log( "warn", "bybit", `Ad ${adId}: error actualización: ${e.message}`);
          }
        }
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

    await log( "info", "bybit", `Ciclo completado: ${bybitOrders.length} órdenes, managedAds: ${managedAds.length}`);

    try {
      await autoCloseCycle(prisma, tenantId, label, client, log);
    } catch (e: any) {
      await log( "warn", "bybit", `Auto-close cycle check: ${e.message}`);
    }
  } catch (e: any) {
    await log( "error", "bybit", `Error en ciclo: ${e.message}`);
  }

  return { actions };
}

async function autoCloseCycle(
  prisma: any,
  tenantId: number,
  label: string,
  client: any,
  log: (level: string, exchange: string | null, message: string) => Promise<void>
) {
  const cycle = await prisma.p2PCycle.findFirst({
    where: { tenantId, label, status: "active" },
  });
  if (!cycle) return;

  const balanceRes = await client.getBalance("USDT");
  // Si la consulta de saldo falla o no trae el campo esperado, NO se puede
  // confirmar el saldo real — antes esto caía a `balance = 0`, lo que
  // disparaba un auto-cierre falso (0 < minClose) aunque el saldo real
  // nunca hubiera bajado. Ahora se aborta el chequeo este ciclo en vez de
  // asumir que el saldo es 0.
  let balance: number | null = null;
  if (balanceRes?.balance !== undefined) {
    balance = Number(balanceRes.balance);
  } else if (balanceRes?.result?.balance) {
    const usdtCoin = balanceRes.result.balance?.find((c: any) => c.coin === "USDT");
    balance = usdtCoin ? Number(usdtCoin.walletBalance) : null;
  }
  if (balance === null || Number.isNaN(balance)) {
    await log( "warn", null, `Auto-close: no se pudo leer el saldo real, se salta este chequeo (ciclo ${cycle.id})`);
    return;
  }

  const minClose = cycle.minCloseBalance ? Number(cycle.minCloseBalance) : 0;
  if (balance >= minClose) return;

  // El saldo "libre" de Binance baja mientras hay órdenes pendientes (estado
  // TRADING) — ese USDT queda bloqueado aunque la orden nunca se complete
  // (se cancele por tiempo o la cancele el comprador), y se libera solo poco
  // después. Confirmado en vivo: un ciclo se cerró con saldo=29.67 que en
  // realidad eran varias órdenes pendientes bloqueando fondos, no ventas
  // reales — 3 minutos después el saldo ya había vuelto a ~1.700 USDT solo.
  // Por eso NO se cierra mientras haya alguna orden todavía sin resolver:
  // solo se confía en el saldo bajo cuando no hay nada "en el aire".
  //
  // "Sin resolver" es CUALQUIER estado que no sea final — no solo TRADING.
  // Binance tiene estados intermedios entre TRADING y COMPLETED (ej. el
  // comprador ya pagó, pendiente de liberación) que tampoco son definitivos.
  // Confirmado en vivo (ciclo 13): dos órdenes completadas quedaron fuera del
  // cierre porque en el instante del chequeo ya no estaban en TRADING pero
  // tampoco habían llegado a COMPLETED todavía — el bot las dio por
  // "resueltas" antes de tiempo. Cada orden que entra debe llegar a un
  // estado FINAL (completada o cancelada) antes de poder cerrar el ciclo.
  const FINAL_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELLED_BY_SYSTEM"]);
  const recentOrdersRes = await client.getOrders({ page: 1, rows: 20 });
  const recentOrders = recentOrdersRes?.data || [];
  const hasPending = recentOrders.some((o: any) => !FINAL_ORDER_STATUSES.has(o.orderStatus));
  if (hasPending) {
    await log( "info", null, `Auto-close: saldo bajo (${balance}) pero hay orden(es) pendiente(s) sin resolver — se espera a que se resuelvan antes de cerrar el ciclo ${cycle.id}`);
    return;
  }

  await log( "info", null, `Auto-cerrando ciclo ${cycle.id}: balance USDT=${balance}, minClose=${minClose}`);

  const startMs = Number(cycle.startTime);
  const endMs = Date.now();
  const { totalUsdt, totalBinanceClp, firstOrder, lastOrder } =
    await computeCycleOrderStats(client, startMs, endMs, recentOrders);

  const totalManualClp = Number(cycle.totalManualClp);

  await prisma.p2PCycle.update({
    where: { id: cycle.id },
    data: {
      status: "closed",
      endTime: new Date(endMs),
      totalUsdt,
      totalBinanceClp,
      totalManualClp,
      firstOrderNumber: firstOrder?.orderNumber ?? null,
      firstOrderClp: firstOrder ? Math.round(Number(firstOrder.totalPrice)) || 0 : null,
      firstOrderTime: firstOrder ? new Date(Number(firstOrder.createTime)) : null,
      lastOrderNumber: lastOrder?.orderNumber ?? null,
      lastOrderClp: lastOrder ? Math.round(Number(lastOrder.totalPrice)) || 0 : null,
      lastOrderTime: lastOrder ? new Date(Number(lastOrder.createTime)) : null,
    },
  });

  await log( "info", null, `Ciclo ${cycle.id} cerrado automáticamente: ${totalUsdt} USDT, ${totalBinanceClp + totalManualClp} CLP`);
}
