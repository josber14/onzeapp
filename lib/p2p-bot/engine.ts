import { prisma } from "@/lib/prisma";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "./bybit-adapter";
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
    dailyVolumeCapUsdt: config.dailyVolumeCapUsdt ? Number(config.dailyVolumeCapUsdt) : null,
    circuitBreakPct: Number(config.circuitBreakPct),
    cycleInterval: Number(config.cycleInterval) || 30,
    minCompetitorCapital: config.minCompetitorCapital ? Number(config.minCompetitorCapital) : null,
    pauseUntil: config.pauseUntil?.toISOString() || null,
    lastStartedAt: config.lastStartedAt?.toISOString() || null,
    lastStoppedAt: config.lastStoppedAt?.toISOString() || null,
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
  if (data.dailyVolumeCapUsdt !== undefined) update.dailyVolumeCapUsdt = data.dailyVolumeCapUsdt;
  if (data.circuitBreakPct !== undefined) update.circuitBreakPct = data.circuitBreakPct;
  if (data.cycleInterval !== undefined) update.cycleInterval = data.cycleInterval;
  if (data.minCompetitorCapital !== undefined) update.minCompetitorCapital = data.minCompetitorCapital;

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
      circuitBreakPct: data.circuitBreakPct ?? 3,
      cycleInterval: data.cycleInterval ?? 30,
      minCompetitorCapital: data.minCompetitorCapital ?? null,
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
  level?: string
) {
  const where: any = { tenantId };
  if (level) where.level = level;

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
        const result = await runBinanceCycle(tenantId, activeConfig);
        actions.push(...result.actions);
        if (result.actions.length > 0) {
          await logBot(
            tenantId,
            "info",
            "binance",
            `${result.actions.length} acción(es) ejecutada(s)`,
            { actions: result.actions }
          );
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

async function runBinanceCycle(
  tenantId: number,
  config: P2PBotConfigData | P2PBotExchangeConfigData
): Promise<{ actions: BotAction[]; marketPrice: number }> {
  const actions: BotAction[] = [];
  const actionsLog: string[] = [];

  try {
    const baseUrl = getBaseUrl();
    const tokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `onze_session=${process.env.BOT_SESSION_TOKEN || ""}` },
    });
    if (!tokenRes.ok) {
      actionsLog.push("No session token for bot API calls");
      return { actions, marketPrice: 0 };
    }
  } catch {
    actionsLog.push("Cannot fetch own API (running in dev?)");
  }

  return { actions, marketPrice: 0 };
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

    // 4. Determine minimum sell price (absolute CLP, 0 = auto from active capacity)
    let minSellPrice = Number(config.priceFloorPct) || 0;
    if (!minSellPrice) {
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

    // Filter viable competitors (price >= minSellPrice)
    const viable = minSellPrice
      ? competitors.filter((c: any) => Number(c.price) >= minSellPrice)
      : competitors;

    if (viable.length === 0) {
      await logBot(tenantId, "info", "bybit", "Sin competidores viables encontrados");
      return { actions };
    }

    // 5. Sort by price ascending
    viable.sort((a: any, b: any) => Number(a.price) - Number(b.price));

    // 6. Find next viable competitor (skip our own ads)
    const myAdIds = new Set(myAds.map((a: any) => a.id));
    const nextViable = viable.find((c: any) => !myAdIds.has(c.id));

    if (!nextViable) {
      await logBot(tenantId, "info", "bybit", "Solo nuestros anuncios en el mercado");
      return { actions };
    }

    // 7. Calculate target price
    const top1Diff = Number(config.top1Diff) || 0.1;
    const competitorPrice = Number(nextViable.price);
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
      if (diff > 0.01) {
        try {
          await client.updateAd({
            id: ourSellAd.id,
            price: targetPrice.toFixed(2),
            actionType: "MODIFY",
          });
          actions.push({ action: "update_price", exchange: "bybit", adId: ourSellAd.id, currentPrice: Number(ourSellAd.price), suggestedPrice: targetPrice, reason: `Precio actualizado a ${targetPrice.toFixed(2)}`, timestamp: Date.now() });
          await logBot(tenantId, "info", "bybit", `Ad ${ourSellAd.id} precio actualizado: ${currentPrice} → ${targetPrice.toFixed(2)}`);
        } catch (e: any) {
          await logBot(tenantId, "warn", "bybit", `No se pudo actualizar precio: ${e.message}`);
        }
      }
    } else {
      await logBot(tenantId, "info", "bybit", "No hay anuncio de venta propio. Crear uno manualmente desde el panel.");
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
