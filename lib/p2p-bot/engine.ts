import { prisma } from "@/lib/prisma";
import type {
  P2PBotConfigData,
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
    update.exchanges = JSON.stringify(data.exchanges);
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
        priceFloorPct: data.priceFloorPct ?? 0.2,
        dailyVolumeCapUsdt: data.dailyVolumeCapUsdt ?? null,
        circuitBreakPct: data.circuitBreakPct ?? 3,
        exchanges: JSON.stringify(data.exchanges ?? ["binance", "bybit"]),
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
      if (exchange === "binance") {
        const result = await runBinanceCycle(tenantId, config);
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
          await logBot(
            tenantId,
            "warn",
            "bybit",
            "Sin credenciales Bybit configuradas"
          );
          continue;
        }
        await logBot(
          tenantId,
          "info",
          "bybit",
          "Bybit integración pendiente de API"
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
  config: P2PBotConfigData
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
