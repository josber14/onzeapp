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
    priceSource: config.priceSource || "manual",
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

  for (const exchange of config.exchanges) {
    try {
      const exchangeConfig = await getExchangeConfig(tenantId, exchange);
      const activeConfig = exchangeConfig || config;

      const exPaused =
        activeConfig.pauseUntil !== null && new Date(activeConfig.pauseUntil) > new Date();
      if (!activeConfig.enabled || exPaused) {
        await logBot(tenantId, "info", exchange, `Bot ${exchange} deshabilitado en su sesión`);
        continue;
      }

      if (exchange === "binance") {
        const creds = await prisma.binanceCredentials.findUnique({
          where: { tenantId, isActive: true },
        });
        if (!creds) {
          await logBot(tenantId, "warn", "binance", "Sin credenciales Binance configuradas");
          continue;
        }
        try {
          const result = await runBinanceCycle(tenantId, exchangeConfig || config, creds.apiKey, creds.secretKey);
          actions.push(...result.actions);
          if (result.actions.length > 0) {
            await logBot(tenantId, "info", "binance", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
          }
        } catch (e: any) {
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

  return { ok: true, actions };
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
    lastQuantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.quantity ?? 0),
    quantity: Number(adv.surplusAmount ?? adv.tradableQuantity ?? adv.quantity ?? 0),
    minAmount: Number(adv.minSingleTransAmount ?? adv.minAmount ?? 0),
    maxAmount: Number(adv.maxSingleTransAmount ?? adv.maxAmount ?? 0),
    paymentMethods: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) => pm.tradeMethodName ?? pm.name ?? String(pm)),
    payments: (adv.tradeMethods ?? adv.paymentMethods ?? []).map((pm: any) => pm.identifier ?? pm.payType ?? String(pm)),
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

  try {
    // 1. Get our current balance (non-critical)
    try {
      const balanceRes = await client.getBalance("USDT");
      const balance = Number(balanceRes?.data?.[0]?.balance ?? 0);
      await logBot(tenantId, "info", "binance", `Saldo USDT: ${balance}`);
    } catch (e: any) {
      await logBot(tenantId, "warn", "binance", `Balance no disponible: ${e.message}`);
    }

    // 2. Get our current ads from Binance
    let myAds: any[] = [];
    try {
      const myAdsRes = await client.getMyAds(1, 50);
      // Try multiple response formats
      let raw: any[] = [];
      if (Array.isArray(myAdsRes?.data)) {
        raw = myAdsRes.data;
      } else if (myAdsRes?.data?.items && Array.isArray(myAdsRes.data.items)) {
        raw = myAdsRes.data.items;
      } else if (myAdsRes?.data?.list && Array.isArray(myAdsRes.data.list)) {
        raw = myAdsRes.data.list;
      } else if (myAdsRes?.data?.records && Array.isArray(myAdsRes.data.records)) {
        raw = myAdsRes.data.records;
      } else if (myAdsRes?.data?.result && Array.isArray(myAdsRes.data.result)) {
        raw = myAdsRes.data.result;
      } else if (myAdsRes?.result && Array.isArray(myAdsRes.result)) {
        raw = myAdsRes.result;
      } else if (myAdsRes?.list && Array.isArray(myAdsRes.list)) {
        raw = myAdsRes.list;
      }
      myAds = raw.map(normalizeBinanceAd);
      await logBot(tenantId, "info", "binance", `Mis anuncios: ${myAds.length}`);
      if (myAds.length === 0) {
        await logBot(tenantId, "debug", "binance", `Respuesta getMyAds: ${JSON.stringify(myAdsRes).slice(0, 500)}`);
      }
    } catch (e: any) {
      await logBot(tenantId, "error", "binance", `Error getMyAds: ${e.message}`);
      throw e;
    }

    // Filter to only the bot-managed ad (if user has marked one)
    try {
      const managedAd = await prisma.p2PBotAd.findFirst({
        where: { tenantId, exchange: "binance", botManaged: true },
      });
      if (managedAd?.adId) {
        const filtered = myAds.filter((a: any) => String(a.id) === String(managedAd.adId));
        if (filtered.length > 0) {
          myAds = filtered;
        }
      }
    } catch (e) {
      // fall back to all ads
    }

    // Determine pay types for competitor filtering
    const competePayTypes = (config as any).competePayTypes as string[] | null | undefined;

    // 3. Get online competitor ads
    let competitors: any[] = [];
    try {
      let adPayTypes: string[] | undefined;
      if (competePayTypes && competePayTypes.length > 0 && competePayTypes[0] !== "*") {
        if (competePayTypes[0] === "__match_ad__") {
          // Auto-detect: find our sell ad and use its payment methods
          const ourSell = myAds.find(
            (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
          );
          if (ourSell?.payments?.length) {
            adPayTypes = ourSell.payments;
            await logBot(tenantId, "info", "binance", `Filtrando competidores por métodos de pago del anuncio: ${ourSell.payments.join(", ")}`);
          }
        } else {
          adPayTypes = competePayTypes;
          await logBot(tenantId, "info", "binance", `Filtrando competidores por métodos de pago: ${competePayTypes!.join(", ")}`);
        }
      }

      // tradeType: "BUY" → returns SELL ads (other sellers we compete with)
      const onlineRes = await client.getOnlineAds({
        asset: "USDT",
        fiat: "CLP",
        tradeType: "BUY",
        rows: 20,
        payTypes: adPayTypes,
      });
      const raw = onlineRes?.data ?? [];
      competitors = raw.map(normalizeBinanceAd);
      await logBot(tenantId, "info", "binance", `OnlineAds: ${competitors.length} items`);
      const samplePrices = competitors.slice(0, 5).map((c: any) => `${c.price}`).join(", ");
      if (competitors.length) {
        await logBot(tenantId, "info", "binance", `Precios: ${samplePrices}`);
      }
    } catch (e: any) {
      await logBot(tenantId, "error", "binance", `Error getOnlineAds: ${e.message}`);
      throw e;
    }

    // 4. Determine minimum sell price (absolute CLP)
    let minSellPrice = Number(config.priceFloorPct) || 0;
    if (minSellPrice <= 0) {
      const activeCap = await prisma.p2PCapacity.findFirst({
        where: {
          tenantId,
          status: { not: "_capital" },
          finishedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeCap?.buyPrice) {
        minSellPrice = Number(activeCap.buyPrice);
        await logBot(tenantId, "info", "binance", `Precio mínimo auto: ${minSellPrice} (capacity ${activeCap.provider})`);
      }
    }

    // Filter viable competitors: only verified merchants, with min capital
    const minCapital = Number((config as any).minCompetitorCapital) || 0;
    const viable = competitors.filter((c: any) => {
      if (minSellPrice && Number(c.price) < minSellPrice) return false;
      if (c.userType && c.userType !== "merchant") return false;
      if (minCapital > 0) {
        const cap = Number(c.lastQuantity ?? c.quantity ?? 0);
        if (cap < minCapital) return false;
      }
      return true;
    });

    if (viable.length === 0) {
      await logBot(tenantId, "info", "binance", "Sin competidores viables encontrados");
      return { actions };
    }

    // 5. Sort by price ascending
    viable.sort((a: any, b: any) => Number(a.price) - Number(b.price));

    // 6. Skip our own ads
    const myAdIds = new Set(myAds.map((a: any) => a.id));
    const sortedCompetitors = viable.filter((c: any) => !myAdIds.has(c.id));

    if (sortedCompetitors.length === 0) {
      await logBot(tenantId, "info", "binance", "Solo nuestros anuncios en el mercado");
      return { actions };
    }

    // 7. Calculate target price with safe margin
    const top1Diff = Number(config.top1Diff) || 0.1;
    const commissionPct = Number((config as any).commissionPct) || 0.14;
    const safeMarginPct = Number((config as any).safeMarginPct) || 0;

    // Real cost = minSellPrice + commission (solo Binance aplica comisión)
    const isBinance = "commissionPct" in (config as any);
    const realCost = minSellPrice ? minSellPrice * (1 + (isBinance ? commissionPct : 0) / 100) : 0;

    // Find the bot's current price to know if we're already #1
    const ourSellAd = myAds.find(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );
    const currentPrice = ourSellAd ? Number(ourSellAd.price) : 0;

    // Collect competitors that pass safe margin
    const viableCompetitors: any[] = [];
    for (let i = 0; i < sortedCompetitors.length; i++) {
      const comp = sortedCompetitors[i];
      const marginPct = realCost > 0 ? ((Number(comp.price) - realCost) / realCost) * 100 : 999;
      if (marginPct >= safeMarginPct) {
        viableCompetitors.push(comp);
      }
    }

    let targetCompetitor: any = null;
    let targetIndex = 0;

    if (viableCompetitors.length === 0) {
      if (sortedCompetitors.length > 0) {
        targetCompetitor = sortedCompetitors[sortedCompetitors.length - 1];
        targetIndex = sortedCompetitors.length - 1;
        await logBot(tenantId, "warn", "binance", `Ningún competidor cumple margen seguro (${safeMarginPct}%), usando el más caro: ${Number(targetCompetitor.price).toFixed(2)}`);
      }
    } else if (currentPrice > 0 && Number(viableCompetitors[0].price) > currentPrice) {
      // Bot is already cheaper than #1
      // Try skipping to #2 only if target stays below #1's price (evita oscilación)
      let skipTarget: any = null;
      if (viableCompetitors.length > 1) {
        const skipTargetPrice = Number(viableCompetitors[1].price) - top1Diff;
        const firstPrice = Number(viableCompetitors[0].price);
        if (skipTargetPrice < firstPrice) {
          skipTarget = viableCompetitors[1];
        }
      }
      targetCompetitor = skipTarget || viableCompetitors[0];
      targetIndex = sortedCompetitors.indexOf(targetCompetitor);
      await logBot(tenantId, "info", "binance",
        skipTarget
          ? `Bot ya es #1 (${currentPrice.toFixed(2)} < ${Number(viableCompetitors[0].price).toFixed(2)}), apuntando a #${targetIndex + 1}: ${Number(targetCompetitor.price).toFixed(2)}`
          : `Bot ya es #1, target #1 (${Number(targetCompetitor.price).toFixed(2)}) para no oscilar`
      );
    } else {
      targetCompetitor = viableCompetitors[0];
      targetIndex = sortedCompetitors.indexOf(targetCompetitor);
      await logBot(tenantId, "info", "binance", `Target #${targetIndex + 1}: ${Number(targetCompetitor.price).toFixed(2)} (costo real: ${realCost.toFixed(2)}, margen: ${(((Number(targetCompetitor.price) - realCost) / realCost) * 100).toFixed(2)}%)`);
    }

    if (!targetCompetitor) {
      await logBot(tenantId, "warn", "binance", "Sin competidores para targetear");
      return { actions };
    }

    const competitorPrice = Number(targetCompetitor.price);
    let targetPrice = competitorPrice - top1Diff;

    // Use realCost as floor for Binance (incl. comisión), minSellPrice for others
    if (isBinance && realCost && targetPrice < realCost) {
      targetPrice = realCost;
    } else if (minSellPrice && targetPrice < minSellPrice) {
      targetPrice = minSellPrice;
    }

    // 8. Update or create our sell ad

    if (ourSellAd) {
      const diff = Math.abs(currentPrice - targetPrice);
      if (diff >= 0.005) {
        let adId = ourSellAd.id;
        let fullAd: any = ourSellAd;
        try {
          // Get full ad details to preserve all fields
          const adDetailRes = await client.getAdDetail(ourSellAd.id);
          const detailData = adDetailRes?.data ?? adDetailRes?.result ?? {};
          fullAd = normalizeBinanceAd(detailData);
          await logBot(tenantId, "debug", "binance", `Ad detail: ${JSON.stringify({ price: fullAd.price, qty: fullAd.lastQuantity })}`);

          const payIds = (fullAd.payments ?? []).map((p: any) => String(p.paymentMethodId ?? p.id ?? p));

          const updateFields: Record<string, any> = {
            adId,
            price: targetPrice.toFixed(2),
            quantity: String(fullAd.lastQuantity ?? fullAd.quantity ?? "0"),
            minAmount: String(fullAd.minAmount ?? "0"),
            maxAmount: String(fullAd.maxAmount ?? "0"),
            paymentPeriod: fullAd.paymentPeriod ?? 15,
            remark: fullAd.remark ?? "",
          };
          if (payIds.length) updateFields.payIds = payIds;
          await client.updateAd(updateFields);
          actions.push({ action: "update_price", exchange: "binance", adId, currentPrice, suggestedPrice: targetPrice, reason: `Precio actualizado a ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
          await logBot(tenantId, "info", "binance", `Ad ${adId} precio actualizado: ${currentPrice} → ${targetPrice.toFixed(2)}`);
        } catch (e: any) {
          await logBot(tenantId, "warn", "binance", `No se pudo actualizar precio: ${e.message}`);
        }
      }
    } else {
      await logBot(tenantId, "info", "binance", "No hay anuncio de venta propio. Crear uno manualmente desde el panel.");
    }

    // Store market snapshot
    try {
      const ourAdInfo = ourSellAd ? {
        id: ourSellAd.id,
        price: Number(ourSellAd.price),
        lastQuantity: Number(ourSellAd.lastQuantity ?? ourSellAd.quantity ?? 0),
        minAmount: Number(ourSellAd.minAmount ?? 0),
        maxAmount: Number(ourSellAd.maxAmount ?? 0),
      } : null;
      const snapshotCompetitors = sortedCompetitors.slice(0, 50).map((c: any) => ({
        id: c.id,
        nickName: c.nickName,
        price: Number(c.price),
        minAmount: Number(c.minAmount ?? 0),
        maxAmount: Number(c.maxAmount ?? 0),
        lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
        orderCount: Number(c.orderCount ?? 0),
        completionRate: Number(c.completionRate ?? 0),
        recentOrderCount: Number(c.recentOrderCount ?? 0),
        recentExecuteRate: Number(c.recentExecuteRate ?? 0),
        monthOrderCount: Number(c.monthOrderCount ?? 0),
        monthExecuteRate: Number(c.monthExecuteRate ?? 0),
        paymentMethods: (c.paymentMethods ?? []).map((pm: any) => ({
          id: pm.id ?? pm.paymentMethodId ?? pm,
          name: pm.name ?? pm.paymentMethodName ?? "",
          identifier: pm.identifier ?? "",
        })),
      }));
      await prisma.p2PBotMarketSnapshot.create({
        data: {
          tenantId,
          exchange: "binance",
          side: "1",
          competitors: JSON.parse(JSON.stringify(snapshotCompetitors)),
          ourAd: ourAdInfo ? JSON.parse(JSON.stringify(ourAdInfo)) : undefined,
          targetPrice: targetPrice ?? undefined,
        },
      });
    } catch (e: any) {
      await logBot(tenantId, "warn", "binance", `Snapshot no almacenado: ${e.message}`);
    }

    // 9. Sync orders from Binance to local DB
    let binanceOrders: any[] = [];
    try {
      const ordersRes = await client.getOrders({ page: 1, rows: 30 });
      binanceOrders = ordersRes?.data ?? [];
      for (const o of binanceOrders) {
        const orderId = o.orderNo ?? o.id;
        const existing = await prisma.p2PBotOrder.findFirst({
          where: { tenantId, orderNumber: orderId, exchange: "binance" },
        });
        if (!existing) {
          await prisma.p2PBotOrder.create({
            data: {
              tenantId,
              exchange: "binance",
              orderNumber: orderId,
              tradeType: o.tradeType === "SELL" ? "SELL" : "BUY",
              asset: o.asset || "USDT",
              fiat: o.fiat || "CLP",
              amount: Number(o.amount) || 0,
              totalPrice: Number(o.totalPrice) || 0,
              unitPrice: Number(o.unitPrice) || 0,
              status: o.orderStatus || "pending",
              counterparty: o.counterpartyNickName || "",
              executedAt: o.createTime ? new Date(Number(o.createTime)) : new Date(),
            },
          });
          await logBot(tenantId, "info", "binance", `Orden #${orderId} sincronizada (${o.orderStatus})`);
        }
      }
    } catch (e: any) {
      await logBot(tenantId, "warn", "binance", `Órdenes no disponibles: ${e.message}`);
    }

    await logBot(tenantId, "info", "binance", `Ciclo completado: ${binanceOrders.length} órdenes, ${competitors.length} competidores`);
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
    try {
      const balanceRes = await client.getBalance("USDT");
      const usdtCoin = balanceRes?.result?.balance?.find((c: any) => c.coin === "USDT");
      const balance = usdtCoin ? Number(usdtCoin.walletBalance) : 0;
      await logBot(tenantId, "info", "bybit", `Saldo USDT: ${balance}`);
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

    // Filter to only the bot-managed ad (if user has marked one)
    try {
      const managedAd = await prisma.p2PBotAd.findFirst({
        where: { tenantId, exchange: "bybit", botManaged: true },
      });
      if (managedAd?.adId) {
        const filtered = myAds.filter((a: any) => String(a.id) === String(managedAd.adId));
        if (filtered.length > 0) {
          myAds = filtered;
        }
      }
    } catch (e) {
      // fall back to all ads
    }

    // 3. Get online competitor ads
    let competitors: any[] = [];
    try {
      const onlineRes = await client.getOnlineAds({
        tokenId: "USDT",
        currencyId: "CLP",
        side: "1", // sellers
      });
      competitors = onlineRes?.result?.items || [];
    } catch (e: any) {
      await logBot(tenantId, "error", "bybit", `Error getOnlineAds: ${e.message}`);
      throw e;
    }
    await logBot(tenantId, "info", "bybit", `OnlineAds: ${competitors.length} items`);
    const samplePrices = competitors.slice(0, 5).map((c: any) => `${c.price}`).join(", ");
    if (competitors.length) {
      await logBot(tenantId, "info", "bybit", `Precios: ${samplePrices}`);
    }

    // 4. Determine minimum sell price (absolute CLP)
    let minSellPrice = Number(config.priceFloorPct) || 0;
    if (minSellPrice <= 0) {
      const activeCap = await prisma.p2PCapacity.findFirst({
        where: {
          tenantId,
          status: { not: "_capital" },
          finishedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeCap?.buyPrice) {
        minSellPrice = Number(activeCap.buyPrice);
        await logBot(tenantId, "info", "bybit", `Precio mínimo auto: ${minSellPrice} (capacity ${activeCap.provider})`);
      }
    }

    // Filter viable competitors (price >= minSellPrice) and (capital >= minCompetitorCapital if set)
    const minCapital = Number((config as any).minCompetitorCapital) || 0;
    const viable = competitors.filter((c: any) => {
      if (minSellPrice && Number(c.price) < minSellPrice) return false;
      if (minCapital > 0) {
        const cap = Number(c.lastQuantity ?? c.quantity ?? 0);
        if (cap < minCapital) return false;
      }
      return true;
    });

    if (viable.length === 0) {
      await logBot(tenantId, "info", "bybit", "Sin competidores viables encontrados");
      return { actions };
    }

    // 5. Sort by price ascending
    viable.sort((a: any, b: any) => Number(a.price) - Number(b.price));

    // 6. Skip our own ads and find competitors by position
    const myAdIds = new Set(myAds.map((a: any) => a.id));
    const sortedCompetitors = viable.filter((c: any) => !myAdIds.has(c.id));

    if (sortedCompetitors.length === 0) {
      await logBot(tenantId, "info", "bybit", "Solo nuestros anuncios en el mercado");
      return { actions };
    }

    // 7. Calculate target price with safe margin
    const top1Diff = Number(config.top1Diff) || 0.1;
    const commissionPct = Number((config as any).commissionPct) || 0;
    const safeMarginPct = Number((config as any).safeMarginPct) || 0;

    // Bybit no cobra comisión
    const realCost = minSellPrice || 0;

    // Find the best competitor respecting safe margin
    let targetCompetitor: any = null;
    let targetIndex = 0;

    for (let i = 0; i < sortedCompetitors.length; i++) {
      const comp = sortedCompetitors[i];
      const marginPct = realCost > 0 ? ((Number(comp.price) - realCost) / realCost) * 100 : 999;
      if (marginPct >= safeMarginPct) {
        targetCompetitor = comp;
        targetIndex = i;
        break;
      }
    }

    // Fallback: if no competitor meets margin, use the highest price competitor
    if (!targetCompetitor && sortedCompetitors.length > 0) {
      targetCompetitor = sortedCompetitors[sortedCompetitors.length - 1];
      targetIndex = sortedCompetitors.length - 1;
      await logBot(tenantId, "warn", "bybit", `Ningún competidor cumple margen seguro (${safeMarginPct}%), usando el más caro: ${Number(targetCompetitor.price).toFixed(2)}`);
    }

    if (targetCompetitor) {
      await logBot(tenantId, "info", "bybit", `Target #${targetIndex + 1}: ${Number(targetCompetitor.price).toFixed(2)} (costo: ${realCost.toFixed(2)}, margen: ${(((Number(targetCompetitor.price) - realCost) / realCost) * 100).toFixed(2)}%)`);
    }

    const competitorPrice = Number(targetCompetitor.price);
    let targetPrice = competitorPrice - top1Diff;

    // Apply minimum price floor (absolute)
    if (minSellPrice && targetPrice < minSellPrice) {
      targetPrice = minSellPrice;
    }

    // 8. Update or create our sell ad
    const ourSellAd = myAds.find(
      (a: any) => a.side === 1 && a.tokenId === "USDT" && a.currencyId === "CLP"
    );

    if (ourSellAd) {
      const currentPrice = Number(ourSellAd.price);
      const diff = Math.abs(currentPrice - targetPrice);
      if (diff >= 0.005) {
        let adId = ourSellAd.id;
        let fullAd: any = ourSellAd;
        let paymentIds: string[] = [];
        let strTps: any = {};
        try {
          // Get full ad details to preserve all fields
          const adDetailRes = await client.getAdDetail(ourSellAd.id);
          fullAd = adDetailRes?.result?.item || adDetailRes?.result || ourSellAd;
          await logBot(tenantId, "debug", "bybit", `Ad detail: payTerms=${JSON.stringify(fullAd.paymentTerms?.slice(0,1))}, priceType=${fullAd.priceType}, qty=${fullAd.quantity}, lastQty=${fullAd.lastQuantity}`);
          const payObjs = fullAd.paymentTerms ?? fullAd.payments ?? [];
          paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];

          // Build update fields
          const tps = fullAd.tradingPreferenceSet ?? {};
          for (const k of Object.keys(tps)) {
            strTps[k] = String(tps[k] ?? "");
          }

          const updateFields: any = {
            id: adId,
            price: targetPrice.toFixed(2),
            actionType: "MODIFY",
            priceType: String(fullAd.priceType ?? "0"),
            premium: String(fullAd.premium ?? "0"),
            quantity: String(fullAd.lastQuantity ?? fullAd.quantity ?? "0"),
            minAmount: String(fullAd.minAmount ?? "0"),
            maxAmount: String(fullAd.maxAmount ?? "0"),
            paymentPeriod: String(fullAd.paymentPeriod ?? "15"),
            paymentIds,
            remark: String(fullAd.remark ?? ""),
            tradingPreferenceSet: strTps,
          };
          await client.updateAd(updateFields);
          actions.push({ action: "update_price", exchange: "bybit", adId, currentPrice, suggestedPrice: targetPrice, reason: `Precio actualizado a ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
          await logBot(tenantId, "info", "bybit", `Ad ${adId} precio actualizado: ${currentPrice} → ${targetPrice.toFixed(2)}`);
        } catch (e: any) {
          if (e.message?.includes("912120050")) {
            // Rate limit hit — recreate the ad to get a fresh update counter
            await logBot(tenantId, "info", "bybit", `Rate limit alcanzado, recreando anuncio ${adId}...`);
            // Delete old ad
            await client.removeAd(adId);
            await logBot(tenantId, "info", "bybit", `Anuncio ${adId} eliminado.`);
            // Create new ad with offset price so Bybit doesn't reject (error 90043)
            const recreatePrice = targetPrice + 0.5;
            const postFields: any = {
              tokenId: "USDT",
              currencyId: "CLP",
              side: "1",
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
            };
            await logBot(tenantId, "debug", "bybit", `postAd payload: ${JSON.stringify(postFields)}`);
            const newAdRes = await client.postAd(postFields);
            const newAdId = newAdRes?.result?.item?.id ?? newAdRes?.result?.id;
            if (newAdId) {
              actions.push({ action: "recreate_ad", exchange: "bybit", adId: newAdId, suggestedPrice: targetPrice, reason: `Nuevo anuncio creado en ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
              await logBot(tenantId, "info", "bybit", `Nuevo anuncio ${newAdId} creado en ${targetPrice.toFixed(2)}`);
            }
          } else {
            await logBot(tenantId, "warn", "bybit", `No se pudo actualizar precio: ${e.message}`);
          }
        }
      }
    } else {
      await logBot(tenantId, "info", "bybit", "No hay anuncio de venta propio. Crear uno manualmente desde el panel.");
    }

    // Store market snapshot
    try {
      const ourAdInfo = ourSellAd ? {
        id: ourSellAd.id,
        price: Number(ourSellAd.price),
        lastQuantity: Number(ourSellAd.lastQuantity ?? ourSellAd.quantity ?? 0),
        minAmount: Number(ourSellAd.minAmount ?? 0),
        maxAmount: Number(ourSellAd.maxAmount ?? 0),
      } : null;
      const snapshotCompetitors = sortedCompetitors.slice(0, 50).map((c: any) => ({
        id: c.id,
        nickName: c.nickName,
        price: Number(c.price),
        minAmount: Number(c.minAmount ?? 0),
        maxAmount: Number(c.maxAmount ?? 0),
        lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
        orderCount: Number(c.orderCount ?? 0),
        completionRate: Number(c.completionRate ?? 0),
        recentOrderCount: Number(c.recentOrderCount ?? 0),
        recentExecuteRate: Number(c.recentExecuteRate ?? 0),
        monthOrderCount: Number(c.monthOrderCount ?? 0),
        monthExecuteRate: Number(c.monthExecuteRate ?? 0),
        paymentMethods: (c.paymentMethods ?? c.payments ?? []).map((pm: any) => ({
          id: pm.id,
          name: pm.name ?? "",
          identifier: pm.identifier ?? "",
        })),
      }));
      await prisma.p2PBotMarketSnapshot.create({
        data: {
          tenantId,
          exchange: "bybit",
          side: "1",
          competitors: JSON.parse(JSON.stringify(snapshotCompetitors)),
          ourAd: ourAdInfo ? JSON.parse(JSON.stringify(ourAdInfo)) : undefined,
          targetPrice: targetPrice ?? undefined,
        },
      });
    } catch (e: any) {
      await logBot(tenantId, "warn", "bybit", `Snapshot no almacenado: ${e.message}`);
    }

    // 9. Sync orders from Bybit to local DB
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
              tenantId,
              exchange: "bybit",
              orderNumber: o.id,
              tradeType: o.side === 0 ? "BUY" : "SELL",
              asset: o.tokenId || "USDT",
              fiat: o.currencyId || "CLP",
              amount: Number(o.amount) || 0,
              totalPrice: Number(o.amount) * Number(o.price) || 0,
              unitPrice: Number(o.price) || 0,
              status: bybitOrderStatusLabel(Number(o.status)),
              counterparty: o.targetNickName || "",
              executedAt: new Date(Number(o.createDate)),
            },
          });
          await logBot(tenantId, "info", "bybit", `Orden #${o.id} sincronizada (${bybitOrderStatusLabel(Number(o.status))})`);
        }
      }
    } catch (e: any) {
      await logBot(tenantId, "warn", "bybit", `Órdenes no disponibles: ${e.message}`);
    }

    await logBot(tenantId, "info", "bybit", `Ciclo completado: ${bybitOrders.length} órdenes, ${competitors.length} competidores`);
  } catch (e: any) {
    await logBot(tenantId, "error", "bybit", `Error en ciclo: ${e.message}`);
  }

  return { actions };
}
