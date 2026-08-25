import { prisma } from "@/lib/prisma";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "./bybit-adapter";
import { BinanceP2PClient } from "./binance-adapter";
import { canCallPriority, canCallNonUrgent, recordCall, getUsage } from "./rate-limiter";
import { computeCycleOrderStats, computeLocalCycleStats, mapCycleOrdersForDisplay } from "./cycle-stats";
import { processChats } from "./chat-agent";
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
  // Autolímite 36/min: cuando una corrección de precio empieza a fallar y no
  // se logra resolver en unos segundos, el anuncio se oculta como freno de
  // emergencia (ver rate-limiter.ts) en vez de quedar expuesto a un precio
  // desactualizado. correctionFailSince=0 → sin problema. hiddenAt>0 → oculto.
  correctionFailSince: number;
  hiddenAt: number;
  lastRetryAttemptAt: number;
}
interface BinanceState {
  lastCompetitorFetch: number;
  cachedCompetitors: any[];
  cachedMyAds: any[];
  isFetching: boolean;
  lastCompetitorCount: number;
  adStates: Map<string, AdState>;
  lastBuySideFetch: number;
}
const binanceStates = new Map<number, BinanceState>();

// Freno mínimo entre ciclos completos reales por cuenta+exchange (ver uso en
// executeBotCycle) -- clave "tenantId:label:exchange" para no mezclar ONZE
// con ZINPLE ni Binance con Bybit.
const lastFullCycleAt = new Map<string, number>();
const MIN_CYCLE_GAP_MS = 300;

// Captura del lado de compra (side="0") para el Oráculo de mercado -- es
// solo para el panel de análisis, no alimenta ninguna decisión de precio,
// por eso se limita a 1 vez cada 30s (no cada ciclo) para no sumarle mas
// llamadas de las necesarias a la cuenta de Binance/Bybit.
const ORACLE_BUY_SIDE_THROTTLE_MS = 30000;
const bybitBuySideFetch = new Map<number, number>();

// El bloqueo contra procesamiento concurrente del chat vive DENTRO de
// processChats (chat-agent.ts), a nivel de cada ORDEN individual, no acá a
// nivel de cuenta completa — un lock por cuenta completa causaba que, con
// varias conversaciones activas a la vez, todo el mundo esperara en fila
// detrás de quien se estuviera atendiendo en ese momento (confirmado en vivo
// jul 2026: un comprador esperó ~2 min por su respuesta con solo 5
// conversaciones activas). Ver chat-lock.ts para el mecanismo del lock.

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
      lastBuySideFetch: 0,
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
      correctionFailSince: 0,
      hiddenAt: 0,
      lastRetryAttemptAt: 0,
    };
    bs.adStates.set(adId, as);
  }
  return as;
}

async function buildBinanceState(bs: BinanceState, rateLimitKey?: string): Promise<any> {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const allTimestamps: number[] = [];
  const allPriceUpTimestamps: number[] = [];
  let minLastUpdate = 0;
  let anyCooldown = 0;
  let maxWeight = 0;
  let anyHidden = false;
  for (const as of bs.adStates.values()) {
    allTimestamps.push(...as.updateTimestamps.filter(t => t > oneHourAgo));
    allPriceUpTimestamps.push(...as.priceUpTimestamps.filter(t => t > oneHourAgo));
    if (as.lastUpdateAt > minLastUpdate) minLastUpdate = as.lastUpdateAt;
    const backoff = as.rateLimitBackoffMs || 60000;
    if (as.lastRateLimitError > 0 && as.lastRateLimitError + backoff > anyCooldown) anyCooldown = as.lastRateLimitError + backoff;
    if (as.currentWeight > maxWeight) maxWeight = as.currentWeight;
    if (as.hiddenAt > 0) anyHidden = true;
  }
  const active = allTimestamps;
  const activeUp = allPriceUpTimestamps;
  const ultimoCambioHace = minLastUpdate > 0 ? Math.round((now - minLastUpdate) / 1000) : -1;
  const proximoFetchEn = Math.max(0, 6 - Math.round((now - bs.lastCompetitorFetch) / 1000));
  const puedeActualizar = active.length < 30
    && (now - minLastUpdate >= 5000 || minLastUpdate === 0)
    && maxWeight < 4000
    && now >= anyCooldown;
  const rateLimit = rateLimitKey ? await getUsage(rateLimitKey) : { used: 0, cap: 32, reserved: 4, resetInMs: 0 };
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
    // Autolímite real de Binance (36/min por cuenta, confirmado por soporte jul 2026)
    rateLimitUsado: rateLimit.used,
    rateLimitCap: rateLimit.cap,
    rateLimitReservado: rateLimit.reserved,
    rateLimitResetEnMs: rateLimit.resetInMs,
    anuncioOculto: anyHidden,
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
    minAdPriceDiffPct: config.minAdPriceDiffPct != null ? Number(config.minAdPriceDiffPct) : 0.1,
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
    minAdPriceDiffPct: config.minAdPriceDiffPct != null ? Number(config.minAdPriceDiffPct) : 0.1,
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
  if (data.minAdPriceDiffPct !== undefined) update.minAdPriceDiffPct = data.minAdPriceDiffPct;
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
      minAdPriceDiffPct: data.minAdPriceDiffPct ?? 0.1,
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
        if (exchange === "binance") cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
        continue;
      }

      // Freno real entre ciclos completos (ago 2026): el timer del panel
      // pedía este endpoint cada 300ms sin que nada de acá adentro lo
      // frenara de verdad -- cada tick hacía llamadas reales a Binance/Bybit
      // (getMyAds, competidores) sin ningún límite, disparando el uso de CPU
      // en Vercel muy por encima de lo necesario (y probablemente parte de
      // por qué la cuenta chocaba tan seguido con el límite de velocidad no
      // revelado de Binance). MIN_CYCLE_GAP_MS ignora ticks de más dentro de
      // esa ventana y reusa el último estado ya calculado -- "force" (botón
      // de sync manual) siempre lo salta.
      const cycleGateKey = `${tenantId}:${label}:${exchange}`;
      const lastFullCycleAtMs = lastFullCycleAt.get(cycleGateKey) || 0;
      if (!force && Date.now() - lastFullCycleAtMs < MIN_CYCLE_GAP_MS) {
        if (exchange === "binance") cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
        continue;
      }
      lastFullCycleAt.set(cycleGateKey, Date.now());

      if (exchange === "binance") {
        const creds = await prisma.binanceCredentials.findFirst({
          where: { tenantId, isActive: true, label },
        });
        if (!creds) {
          await l("warn", "binance", "Sin credenciales Binance configuradas");
          cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
          continue;
        }

        const binancePromises: Promise<void>[] = [];

        // Run main cycle if bot is enabled, or if force mode (sync button)
        if (!isDisabled || force) {
          binancePromises.push((async () => {
            try {
              const result = await runBinanceCycle(tenantId, activeConfig, creds.apiKey, creds.secretKey, label);
              cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
              if (result.actions.length > 0) {
                actions.push(...result.actions);
                await l( "info", "binance", `${result.actions.length} acción(es) ejecutada(s)`, { actions: result.actions });
              }
            } catch (e: any) {
              cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
              await l( "error", "binance", `Error en ciclo Binance: ${e.message}`);
            }
          })());
        }

        // Run chat processing if enabled (even when main bot is disabled)
        if (chatEnabled) {
          binancePromises.push((async () => {
            await l( "info", "binance", "Iniciando processChats...");
            try {
              const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
              // Anuncios reales de ESTA cuenta (ONZE o ZINPLE) para que el chat
              // sepa a qué anuncio pertenece cada orden (advNo) y use su
              // paymentPeriod real, no el default de 15 min.
              let chatActiveAds: any[] = [];
              try {
                chatActiveAds = await fetchMyBinanceAds(client);
              } catch (e: any) {
                await l( "warn", "binance", `Chat: error al leer anuncios para matchear orden: ${e.message}`);
              }
              await processChats(tenantId, "binance", async () => ({ client }), chatActiveAds, label);
            } catch (e: any) {
              await l( "warn", "binance", `Chat process: ${e.message}`);
            }
          })());
        }

        if (binancePromises.length > 0) await Promise.all(binancePromises);
        if (cycleState.binance === undefined) cycleState.binance = await buildBinanceState(getBinanceState(tenantId), `${tenantId}:${label}`);
      } else if (exchange === "bybit") {
        // Bybit no tiene concepto de ONZE/ZINPLE — es una única cuenta fija.
        // Sin importar bajo qué label (ONZE o ZINPLE) esté corriendo el timer
        // del panel en este momento, las credenciales y el ciclo de Bybit
        // siempre usan "ONZE" — igual que ya se arregló en el guardado de
        // credenciales (bybit-credentials/route.ts) y en la UI del panel.
        const bybitLabel = "ONZE";
        const creds = await prisma.bybitCredentials.findFirst({
          where: { tenantId, isActive: true, label: bybitLabel },
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
              const result = await runBybitCycle(tenantId, activeConfig, creds.apiKey, creds.secretKey, bybitLabel);
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
              await processChats(tenantId, "bybit", async () => ({ client }), [], bybitLabel);
            } catch (e: any) {
              await l( "warn", "bybit", `Chat process: ${e.message}`);
            }
          })());
        }

        if (bybitPromises.length > 0) await Promise.all(bybitPromises);
      } else if (exchange === "okx") {
        // Mismo caso que Bybit: OKX es una única cuenta fija, sin ONZE/ZINPLE.
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

async function fetchMyBinanceAds(client: BinanceP2PClient): Promise<any[]> {
  const myAdsRes = await client.getMyAds(1, 50);
  let raw: any[] = [];
  if (Array.isArray(myAdsRes?.data)) raw = myAdsRes.data;
  else if (myAdsRes?.data?.items && Array.isArray(myAdsRes.data.items)) raw = myAdsRes.data.items;
  else if (myAdsRes?.data?.list && Array.isArray(myAdsRes.data.list)) raw = myAdsRes.data.list;
  else if (myAdsRes?.data?.records && Array.isArray(myAdsRes.data.records)) raw = myAdsRes.data.records;
  else if (myAdsRes?.data?.result && Array.isArray(myAdsRes.data.result)) raw = myAdsRes.data.result;
  else if (myAdsRes?.result && Array.isArray(myAdsRes.result)) raw = myAdsRes.result;
  else if (myAdsRes?.list && Array.isArray(myAdsRes.list)) raw = myAdsRes.list;
  return raw.map(normalizeBinanceAd);
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
  const rateLimitKey = `${tenantId}:${label}`;
  const log = (level: string, exchange: string | null, message: string, details?: any): Promise<void> =>
    logBot(tenantId, level, exchange, message, details, label);

  try {
    // 1. Get our current ads from Binance
    let myAds: any[] = [];
    try {
      myAds = await fetchMyBinanceAds(client);
      bs.cachedMyAds = myAds;
      if (myAds.length === 0) {
        await log( "debug", "binance", `Respuesta getMyAds vacía`);
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
            // Autolímite propio (36/min real de Binance por cuenta, confirmado
            // por soporte jul 2026) — el sync de cantidad es prioritario (no es
            // una "persecución" de precio hacia abajo), así que solo se frena si
            // de verdad no queda ningún cupo.
            if (!(await canCallPriority(rateLimitKey))) {
              const u0 = await getUsage(rateLimitKey);
              await log( "info", "binance", `Ad ${ma.adId}: sync de cantidad esperando cupo (autolímite ${u0.used}/${u0.cap} por minuto) — saltando este ciclo`);
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
              await recordCall(rateLimitKey);
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
    // Binance exige (confirmado por soporte, jul 2026): "Para los anuncios
    // publicados con un precio fijo, la diferencia de precio entre anuncios en
    // la misma direccion debe ser ≥ 0.1%." Si dos anuncios propios (mismo lado)
    // quedan mas cerca que esto, Binance restringe la cuenta para cambiar
    // precios — por eso nunca se deja en 0 salvo que el usuario lo pida.
    const exchangeMinAdPriceDiffPct = (config as any).minAdPriceDiffPct != null ? Number((config as any).minAdPriceDiffPct) : 0.1;
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

    // ── Chequeo de límites duplicados entre anuncios propios ──
    // Binance cierra anuncios si el "límite de orden" (mínimo-máximo) de dos
    // anuncios propios en la misma dirección coincide EXACTO, sin importar
    // que el precio sea distinto (confirmado contra la documentación oficial
    // de Merchant Guidelines, jul 2026: "If the price, total order amount,
    // or order limit of the second ad is the same as the first ad, your ads
    // will be closed"). Pedido explícito del usuario: si esto pasa (ej. tras
    // editar un anuncio a mano en la app y olvidar cambiar el límite), el
    // bot se desactiva a sí mismo en esos anuncios puntuales -- no todo el
    // bot -- y avisa bien fuerte en los logs. La reactivación es siempre
    // manual desde el panel, nunca automática.
    {
      const duplicateLimitAdIds = new Set<number>();
      const duplicateLimitBinanceAdIds = new Set<string>();
      for (let i = 0; i < managedAds.length; i++) {
        for (let j = i + 1; j < managedAds.length; j++) {
          const adA = managedAds[i];
          const adB = managedAds[j];
          // Bug real confirmado en vivo (jul 2026): una fila duplicada en
          // P2PBotAd (misma adId real, dos filas distintas por un problema de
          // registro -- ver comentario en app/api/p2p/bot/ads/route.ts) hacía
          // que este chequeo comparara un anuncio CONSIGO MISMO ("mismo
          // límite" siempre va a dar true si es literalmente el mismo
          // anuncio) y lo desactivara sin ningún motivo real. Si las dos filas
          // apuntan al mismo anuncio real, no hay ningún riesgo de duplicado
          // que reportar -- se salta.
          if (String(adA.adId) === String(adB.adId)) continue;
          const sellA = ourSellAds.find((a: any) => String(a.id) === String(adA.adId));
          const sellB = ourSellAds.find((a: any) => String(a.id) === String(adB.adId));
          if (!sellA || !sellB) continue;
          const sameLimit = Number(sellA.minAmount) > 0
            && Number(sellA.minAmount) === Number(sellB.minAmount)
            && Number(sellA.maxAmount) === Number(sellB.maxAmount);
          if (!sameLimit) continue;
          duplicateLimitAdIds.add(adA.id);
          duplicateLimitAdIds.add(adB.id);
          duplicateLimitBinanceAdIds.add(String(adA.adId));
          duplicateLimitBinanceAdIds.add(String(adB.adId));
          await log("error", "binance",
            `🚫 Anuncios ${adA.adId} y ${adB.adId} tienen el MISMO límite (${sellA.minAmount}-${sellA.maxAmount} CLP) -- Binance puede cerrarlos por esto (ver Merchant Guidelines: "order limit" duplicado). Se desactivó el bot en ambos automáticamente. Corrige el límite en la app de Binance y vuelve a activarlos manualmente desde el panel cuando el límite sea distinto.`
          );
        }
      }
      if (duplicateLimitAdIds.size > 0) {
        await prisma.p2PBotAd.updateMany({
          where: { id: { in: [...duplicateLimitAdIds] } },
          data: { botEnabled: false },
        });
        // Pedido explícito del usuario (ago 2026): apagar el bot de NUESTRO
        // lado no alcanza -- el anuncio seguía visible/operativo EN BINANCE,
        // que es justo lo que Binance vigila para cerrar cuentas por límites
        // duplicados. Se oculta el anuncio directo en Binance (visible: 0,
        // mismo mecanismo ya probado como freno de emergencia más abajo en
        // este archivo) sin borrarlo -- se reactiva manual desde el panel,
        // nunca solo, a diferencia del freno de emergencia por precio.
        for (const binanceAdId of duplicateLimitBinanceAdIds) {
          try {
            await client.updateAd({ adId: binanceAdId, visible: 0 });
            await log("warn", "binance", `🔒 Ad ${binanceAdId}: ocultado en Binance (visible: 0) por límite duplicado.`);
          } catch (e: any) {
            await log("warn", "binance", `Ad ${binanceAdId}: no se pudo ocultar en Binance (${e.message}) -- igual quedó apagado de nuestro lado.`);
          }
        }
        managedAds = managedAds.filter(ma => !duplicateLimitAdIds.has(ma.id));
        if (managedAds.length === 0) {
          await log("warn", "binance", "Todos los anuncios gestionados quedaron desactivados por límites duplicados.");
          return { actions };
        }
      }
    }

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

    // Lado de compra (side="0") para el Oráculo de mercado -- throttled a
    // 30s, no alimenta ninguna decisión de precio del bot, solo el panel de
    // análisis. OJO con el mismo quirk ya documentado de Binance: tradeType
    // invertido -- "SELL" es el que trae los anuncios del lado COMPRA.
    if (Date.now() - bs.lastBuySideFetch > ORACLE_BUY_SIDE_THROTTLE_MS) {
      bs.lastBuySideFetch = Date.now();
      try {
        const buyRes = await client.getOnlineAds({ asset: "USDT", fiat: "CLP", tradeType: "SELL", rows: 20, page: 1, payTypes: [] });
        const buyRaw = (buyRes?.data ?? []).map(normalizeBinanceAd);
        const buyComps = buyRaw.slice(0, 50).map((c: any) => ({
          id: c.id, nickName: c.nickName, price: Number(c.price),
          minAmount: Number(c.minAmount ?? 0), maxAmount: Number(c.maxAmount ?? 0),
          lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
          orderCount: Number(c.orderCount ?? 0), completionRate: Number(c.completionRate ?? 0),
        }));
        await prisma.p2PBotMarketSnapshot.create({
          data: {
            tenantId,
            exchange: "binance",
            side: "0",
            competitors: JSON.parse(JSON.stringify(buyComps)),
            ourAd: undefined,
            targetPrice: undefined,
          },
        });
      } catch (e: any) {
        await log("debug", "binance", `Oráculo: error lado compra: ${e.message}`);
      }
    }

    // Use cached competitors
    const rawCompetitors = bs.cachedCompetitors;

    // Get active capacity (initial read)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      if (activeCap?.buyPrice) activeCapacityBuyPrice = Number(activeCap.buyPrice);
    } catch (e) {}

    // Re-read capacity and update ads with correct price
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

    // Precio "efectivo" de cada anuncio propio gestionado, para chequear la
    // distancia minima entre anuncios de la misma cuenta y lado (Binance exige
    // ≥0.1% o restringe la cuenta). Arranca con el precio real vigente en
    // Binance, y se va actualizando con el precio objetivo de cada anuncio a
    // medida que el ciclo avanza — asi el siguiente anuncio de este mismo
    // ciclo ya lo tiene en cuenta y no vuelven a chocar entre si.
    const ownAdPrices = new Map<string, number>();
    for (const ma of managedAds) {
      const sellAd = ourSellAds.find((a: any) => String(a.id) === String(ma.adId));
      if (sellAd) ownAdPrices.set(String(ma.adId), Number(sellAd.price));
    }

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
      // Comerciantes que este anuncio nunca debe seguir/competir, elegidos
      // manualmente por nickname de Binance (ago 2026, pedido explícito del
      // usuario). Vacío por defecto -- no cambia nada si no se configura.
      const adExcludedMerchants = new Set(
        ((managedAd.botExcludedMerchants as string[] | null) || [])
          .map((n) => String(n).trim().toLowerCase())
          .filter(Boolean)
      );
      const adPriceSource = managedAd.botPriceSource || exchangePriceSource;
      const adPriceFloorPct = managedAd.botPriceFloorPct != null ? Number(managedAd.botPriceFloorPct) : (exchangePriceFloorPct > 0 ? exchangePriceFloorPct : null);
      const adCircuitBreakPct = managedAd.botCircuitBreakPct != null ? Number(managedAd.botCircuitBreakPct) : exchangeCircuitBreakPct;
      const adDailyVolumeCapUsdt = managedAd.botDailyVolumeCapUsdt != null ? Number(managedAd.botDailyVolumeCapUsdt) : exchangeDailyVolumeCapUsdt;
      const adMinAdPriceDiffPct = (managedAd as any).botMinAdPriceDiffPct != null ? Number((managedAd as any).botMinAdPriceDiffPct) : exchangeMinAdPriceDiffPct;

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

      // Estrategia del anuncio (ago 2026, pedido explícito del usuario):
      // "top1" (default, comportamiento de siempre) sigue al competidor de
      // arriba. "spread" es un precio FIJO sobre el costo real -- costo +
      // comisión + spread, sin mirar competidores para nada. Confirmado con
      // el usuario: los frenos de seguridad que siguen después (circuit
      // breaker, distancia mínima entre anuncios propios, límite de
      // velocidad de Binance) aplican igual en los dos modos -- por eso
      // "spread" solo reemplaza CÓMO se calcula targetPrice, todo lo que
      // viene después de este bloque queda intacto sin importar el modo.
      const adStrategy = managedAd.botStrategy === "spread" ? "spread" : "top1";
      const adSpreadPct = managedAd.botSpreadPct != null ? Number(managedAd.botSpreadPct) : 0;

      let targetPrice: number;
      let safeFloor: number;

      if (adStrategy === "spread") {
        targetPrice = minSellPrice * (1 + (adCommissionPct + adSpreadPct) / 100);
        safeFloor = targetPrice;
        await log("debug", "binance", `Ad ${adId}: estrategia spread fijo — minSellPrice=${minSellPrice} adCommissionPct=${adCommissionPct} adSpreadPct=${adSpreadPct} targetPrice=${targetPrice.toFixed(4)}`);
      } else {

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
      if (adExcludedMerchants.size > 0) {
        const beforeExclude = competitors.length;
        competitors = competitors.filter((c: any) => !adExcludedMerchants.has(String(c.nickName || "").trim().toLowerCase()));
        if (competitors.length < beforeExclude) {
          await log("debug", "binance", `Ad ${adId}: excluidos ${beforeExclude - competitors.length} competidor(es) por lista de comerciantes bloqueados`);
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
      safeFloor = minSellPrice * (1 + (adCommissionPct + adSafeMarginPct) / 100);
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
      targetPrice = targetCompetitor ? Number(targetCompetitor.price) - adTop1Diff : safeFloor;
      // Nunca quedarse debajo del precio mínimo de seguridad
      if (targetPrice < safeFloor) { targetPrice = safeFloor; }

      } // fin del bloque "top1" (adStrategy !== "spread")

      // ── Distancia mínima con nuestros otros anuncios del mismo lado ──
      // Binance exige ≥0.1% de diferencia entre anuncios propios en la misma
      // dirección (confirmado por soporte, jul 2026) — si no se respeta,
      // restringe la cuenta para cambiar precios (ya pasó una vez). Si el
      // precio objetivo queda demasiado cerca de otro anuncio propio, se aleja
      // lo mínimo necesario, sin bajar nunca del piso de seguridad.
      if (adMinAdPriceDiffPct > 0) {
        for (const [otherId, otherPrice] of ownAdPrices) {
          if (otherId === String(adId) || !otherPrice) continue;
          const gapPct = (Math.abs(targetPrice - otherPrice) / otherPrice) * 100;
          if (gapPct < adMinAdPriceDiffPct) {
            const requiredGap = otherPrice * (adMinAdPriceDiffPct / 100);
            let adjusted = targetPrice <= otherPrice ? otherPrice - requiredGap : otherPrice + requiredGap;
            if (adjusted < safeFloor) adjusted = otherPrice + requiredGap;
            await log( "info", "binance",
              `Ad ${adId}: precio ${targetPrice.toFixed(2)} muy cerca del anuncio ${otherId} (${otherPrice}) — ajustado a ${adjusted.toFixed(2)} para respetar el ${adMinAdPriceDiffPct}% mínimo que exige Binance entre anuncios propios`);
            targetPrice = adjusted;
          }
        }
      }
      ownAdPrices.set(String(adId), targetPrice);

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
      }

      // ── Autolímite propio: 36 llamadas/min reales de Binance por cuenta
      // (confirmado por soporte jul 2026), self-throttle a 32 con margen.
      // Subir precio (o recuperar un anuncio oculto) es prioritario — casi
      // siempre tiene cupo. Bajar persiguiendo competencia es "no urgente":
      // se reservan 4 cupos exclusivos para las prioritarias, así que una
      // bajada se salta antes de tocar ese margen (vuelve a intentar el
      // próximo ciclo, no pasa nada por esperar un poco para bajar).
      const rateOk = isPriceUp ? await canCallPriority(rateLimitKey) : await canCallNonUrgent(rateLimitKey);
      if (!rateOk) {
        const u = await getUsage(rateLimitKey);
        await log( "info", "binance",
          `Ad ${adId}: autolímite (${u.used}/${u.cap} por minuto) — ${isPriceUp ? "esperando cupo para subir" : "bajada no urgente, se salta este ciclo"}`);
        continue;
      }
      // Espacio mínimo entre reintentos del MISMO anuncio tras un fallo
      // reciente, para no martillar en el mismo ciclo/timer.
      if (as.lastRetryAttemptAt > 0 && Date.now() - as.lastRetryAttemptAt < 8000) {
        continue;
      }

      // ── Execute price-only update ──
      // updateAd() reads the ad's full config and resends it unchanged except
      // for price — required so Binance's full-config validation doesn't 187049.
      try {
        const payload: any = { adId, price: targetPrice.toFixed(2) };
        if (as.hiddenAt > 0) payload.visible = 1; // restaurar visibilidad junto con el precio corregido
        await recordCall(rateLimitKey);
        as.lastRetryAttemptAt = Date.now();
        await log( "info", "binance",
          `Ad ${adId}: price update → price=${targetPrice.toFixed(2)}${as.hiddenAt > 0 ? " (restaurando visibilidad)" : ""}`);
        await client.updateAd(payload);
        as.lastUpdateAt = Date.now();
        as.correctionFailSince = 0;
        if (as.hiddenAt > 0) {
          const hiddenForS = Math.round((Date.now() - as.hiddenAt) / 1000);
          await log( "info", "binance", `Ad ${adId}: reactivado — estuvo oculto ${hiddenForS}s`);
          as.hiddenAt = 0;
        }
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
          if (as.correctionFailSince === 0) as.correctionFailSince = Date.now();
          const failingForMs = Date.now() - as.correctionFailSince;
          const u2 = await getUsage(rateLimitKey);
          await log( "warn", "binance",
            `Ad ${adId}: 187049/187040 (autolímite en ${u2.used}/${u2.cap}/min) — lleva ${Math.round(failingForMs / 1000)}s sin poder corregir, reintenta el próximo ciclo`);
          // Freno de emergencia: si no se logra corregir el precio en 25s
          // seguidos, ocultar el anuncio (sin borrarlo) para que no siga
          // tomando órdenes a un precio desactualizado — se reactiva solo
          // apenas haya cupo (ver bloque de éxito arriba).
          if (failingForMs > 25000 && as.hiddenAt === 0 && await canCallPriority(rateLimitKey)) {
            try {
              await recordCall(rateLimitKey);
              await client.updateAd({ adId, visible: 0 });
              as.hiddenAt = Date.now();
              await log( "warn", "binance",
                `🔒 Ad ${adId}: oculto automáticamente tras ${Math.round(failingForMs / 1000)}s sin poder corregir el precio — se reactivará solo en cuanto haya cupo`);
            } catch (e3: any) {
              await log( "warn", "binance", `Ad ${adId}: intento de ocultar también falló: ${e3.message}`);
            }
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

      // Separación entre anuncios de PRECIO (bajado de 5s a 2s y luego a 1s,
      // ago 2026 — pedido explícito del usuario: necesita que el precio
      // reaccione lo más rápido posible, y ya tiene el contador de
      // rate-limit propio en el panel para saber si se está acercando al
      // límite real de Binance). Ojo: esto es SOLO el freno de precio -- el
      // de sync de cantidad (más arriba, "5s de separación entre intentos de
      // sync de cantidad") queda intacto a propósito, el usuario pidió
      // explícitamente no tocar nada de lectura/actualización de saldo.
      if (managedAds.length > 1 && managedAds.indexOf(managedAd) < managedAds.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 5. Sync orders
    // Bug real confirmado (ago 2026): esta sincronización NUNCA guardaba
    // `label` (ONZE/ZINPLE quedaban mezclados sin forma de distinguirlos) y
    // NUNCA actualizaba el estado de una orden ya guardada -- una orden
    // vista por primera vez como "TRADING" quedaba congelada así para
    // siempre, aunque en Binance ya se hubiera completado. Bybit (más abajo
    // en este archivo) ya tenía el arreglo del estado; acá nunca se aplicó.
    // Mismo patrón que Bybit ahora: crear si es nueva, actualizar el estado
    // si cambió.
    try {
      const ordersRes = await client.getOrders({ page: 1, rows: 30 });
      const binanceOrders = ordersRes?.data ?? [];
      for (const o of binanceOrders) {
        const orderId = o.orderNumber ?? o.orderNo ?? o.id;
        const newStatus = String(o.orderStatus ?? o.status ?? "unknown");
        // Bug real confirmado (ago 2026): este fetch (listUserOrderHistory)
        // sí trae la comisión real cobrada por Binance en `o.commission`,
        // pero nunca se guardaba -- toda orden quedaba con comisión 0,
        // inflando la ganancia mostrada en el Dashboard. Se guarda al crear
        // y se rellena en las que ya existían sin ella (nunca cambia
        // después de completada, así que no hace falta pisarla si ya está).
        const commissionUsdt = Number(o.commission ?? 0);
        const existing = await prisma.p2PBotOrder.findFirst({
          where: { tenantId, orderNumber: orderId, exchange: "binance" },
        });
        if (existing) {
          const needsUpdate = existing.status !== newStatus || existing.label !== label || (existing.commission == null && commissionUsdt > 0);
          if (needsUpdate) {
            await prisma.p2PBotOrder.update({
              where: { id: existing.id },
              data: {
                status: newStatus,
                label,
                ...(existing.commission == null && commissionUsdt > 0 ? { commission: commissionUsdt } : {}),
              },
            });
          }
        } else {
          await prisma.p2PBotOrder.create({
            data: {
              tenantId, label, exchange: "binance", orderNumber: orderId,
              tradeType: o.tradeType === "SELL" ? "SELL" : "BUY",
              asset: o.asset || "USDT", fiat: o.fiat || "CLP",
              amount: Number(o.amount ?? o.totalQuantity ?? 0),
              totalPrice: Number(o.totalPrice ?? o.totalAmount ?? 0),
              unitPrice: Number(o.unitPrice ?? o.price ?? 0),
              commission: commissionUsdt,
              status: newStatus,
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
      await autoCloseCycle(prisma, tenantId, label, client, log, "binance");
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

// Lock a nivel de base de datos (no solo en memoria) para "recrear anuncio"
// -- confirmado en vivo: dos ejecuciones del ciclo corriendo al mismo tiempo
// (ej. dos pestañas/servidores del panel abiertos) recreaban el MISMO
// anuncio en paralelo, dejando dos anuncios duplicados y la base de datos
// apuntando al que quedaba eliminado. Un lock en memoria no alcanza porque
// cada proceso de servidor tiene su propia memoria -- por eso el lock se
// guarda en la fila de P2PBotAd, visible para cualquier proceso.
async function claimBybitRecreateLock(managedAdDbId: number): Promise<boolean> {
  // Bug real confirmado en vivo (jul 2026): con 25s, dos ejecuciones
  // concurrentes (ej. el Mac local y Vercel corriendo el mismo ciclo al
  // mismo tiempo) lograron recrear el MISMO anuncio en paralelo -- cada una
  // borró/creó el suyo, dejando 2 anuncios reales vivos en Bybit mientras
  // la base de datos solo alcanzaba a registrar uno. La secuencia completa
  // (apagar viejo, borrar con hasta 3 reintentos, esperas fijas, crear
  // nuevo, activarlo, reintento por 90043) puede tardar bastante más de
  // 25s en la práctica -- se sube a 90s para cubrir el peor caso con
  // margen real, en vez de "casi alcanzar".
  const lockMs = 90000;
  const result = await prisma.p2PBotAd.updateMany({
    where: {
      id: managedAdDbId,
      OR: [{ recreateLockUntil: null }, { recreateLockUntil: { lt: new Date() } }],
    },
    data: { recreateLockUntil: new Date(Date.now() + lockMs) },
  });
  return result.count > 0;
}

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

    // ── Chequeo de límites duplicados entre anuncios propios (mismo motivo
    // documentado arriba en el ciclo de Binance -- ver ese comentario) ──
    {
      const duplicateLimitAdIds = new Set<number>();
      for (let i = 0; i < managedAds.length; i++) {
        for (let j = i + 1; j < managedAds.length; j++) {
          const adA = managedAds[i];
          const adB = managedAds[j];
          // Mismo bug que en runBinanceCycle (ver comentario allá): dos filas
          // de P2PBotAd pueden apuntar al MISMO anuncio real de Bybit (fila
          // duplicada por una carrera con el auto-registro del panel -- ver
          // app/api/p2p/bot/ads/route.ts). Comparar un anuncio consigo mismo
          // siempre "coincide" y lo desactivaba sin ningún riesgo real.
          if (String(adA.adId) === String(adB.adId)) continue;
          const sellA = ourSellAds.find((a: any) => String(a.id) === String(adA.adId));
          const sellB = ourSellAds.find((a: any) => String(a.id) === String(adB.adId));
          if (!sellA || !sellB) continue;
          const sameLimit = Number(sellA.minAmount) > 0
            && Number(sellA.minAmount) === Number(sellB.minAmount)
            && Number(sellA.maxAmount) === Number(sellB.maxAmount);
          if (!sameLimit) continue;
          duplicateLimitAdIds.add(adA.id);
          duplicateLimitAdIds.add(adB.id);
          await log("error", "bybit",
            `🚫 Anuncios ${adA.adId} y ${adB.adId} tienen el MISMO límite (${sellA.minAmount}-${sellA.maxAmount} CLP) -- riesgo de que el exchange los cierre. Se desactivó el bot en ambos automáticamente. Corrige el límite en la app y vuelve a activarlos manualmente desde el panel cuando el límite sea distinto.`
          );
        }
      }
      if (duplicateLimitAdIds.size > 0) {
        await prisma.p2PBotAd.updateMany({
          where: { id: { in: [...duplicateLimitAdIds] } },
          data: { botEnabled: false },
        });
        managedAds = managedAds.filter(ma => !duplicateLimitAdIds.has(ma.id));
        if (managedAds.length === 0) {
          await log("warn", "bybit", "Todos los anuncios gestionados quedaron desactivados por límites duplicados.");
          return { actions };
        }
      }
    }

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

    // Lado de compra (side="0") para el Oráculo de mercado -- throttled a
    // 30s, solo para el panel de análisis, no toca ninguna decisión de precio.
    if (Date.now() - (bybitBuySideFetch.get(tenantId) || 0) > ORACLE_BUY_SIDE_THROTTLE_MS) {
      bybitBuySideFetch.set(tenantId, Date.now());
      try {
        const buyRes = await client.getOnlineAds({ tokenId: "USDT", currencyId: "CLP", side: "0", page: "1", size: "20" });
        const buyRaw = buyRes?.result?.items || [];
        const buyComps = buyRaw.slice(0, 50).map((c: any) => ({
          id: c.id, nickName: c.nickName, price: Number(c.price),
          minAmount: Number(c.minAmount ?? 0), maxAmount: Number(c.maxAmount ?? 0),
          lastQuantity: Number(c.lastQuantity ?? c.quantity ?? 0),
          orderCount: Number(c.orderCount ?? 0), completionRate: Number(c.completionRate ?? 0),
        }));
        await prisma.p2PBotMarketSnapshot.create({
          data: {
            tenantId,
            exchange: "bybit",
            side: "0",
            competitors: JSON.parse(JSON.stringify(buyComps)),
            ourAd: undefined,
            targetPrice: undefined,
          },
        });
      } catch (e: any) {
        await log("debug", "bybit", `Oráculo: error lado compra: ${e.message}`);
      }
    }

    // Get active capacity (initial read)
    let activeCapacityBuyPrice: number | null = null;
    try {
      const activeCap = await getActiveCapacity(prisma, tenantId);
      if (activeCap?.buyPrice) activeCapacityBuyPrice = Number(activeCap.buyPrice);
    } catch (e) {}

    // Re-read capacity and update ads with correct price
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

          // Bybit exige que precio * cantidad disponible sea >= al monto
          // mínimo por transacción (error 912120023) -- si el saldo se
          // vendió por completo justo en este instante (cantidad 0, o muy
          // baja), no tiene sentido intentar publicar/recrear con esos
          // números: se salta este anuncio hasta que vuelva a tener saldo.
          if (Number(targetPrice.toFixed(2)) * Number(updateQuantity) < Number(cappedMin)) {
            await log( "info", "bybit", `Ad ${adId}: saldo insuficiente para el mínimo (${updateQuantity} USDT × ${targetPrice.toFixed(2)} < ${cappedMin} CLP mín.) -- se salta hasta que haya más saldo`);
            continue;
          }

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

          // Si el precio objetivo es igual al que ya está publicado, no hay
          // nada que actualizar de verdad -- llamar a Bybit igual gastaba un
          // "mod" del límite de 10 por anuncio (acercándolo a una recreación
          // innecesaria) y una unidad del cupo de velocidad de la cuenta, sin
          // ningún cambio real que justifique el gasto.
          if (targetPrice.toFixed(2) === currentPrice.toFixed(2)) {
            await log( "debug", "bybit", `Ad ${adId}: precio ya está en ${currentPrice.toFixed(2)}, sin cambios`);
            continue;
          }

          // Recreate at mod 9 (before hitting Bybit's 10-mod limit)
          if (currentMods >= 9 && !(await claimBybitRecreateLock(managedAd.id))) {
            await log( "debug", "bybit", `Ad ${adId}: otra ejecución ya está recreando este anuncio, se salta`);
          } else if (currentMods >= 9) {
            await log( "info", "bybit", `Ad ${adId}: ${currentMods} modificaciones, recreando...`);
            // Bug real confirmado en vivo (jul 2026): acá se usaba
            // currentPrice + 0.50 -- el precio VIEJO pegado en el anuncio,
            // no el precio recién calculado con el margen de seguridad. Si
            // currentPrice ya estaba por debajo del piso de seguridad
            // vigente (ej. tras un cambio de margen o de capacity que el
            // anuncio no había alcanzado a reflejar), el anuncio se
            // recreaba heredando ese mismo precio inseguro. targetPrice ya
            // viene calculado más arriba respetando safeFloor (nunca baja
            // de ahí) -- es el mismo campo que ya usa correctamente el otro
            // camino de recreación (tras rate limit, más abajo en este
            // archivo). Pedido explícito del usuario: la configuración de
            // seguridad SIEMPRE se respeta, sin excepción.
            const recreatePrice = targetPrice;
            // Antes había acá un intento de "apagar" el anuncio viejo con
            // updateAd({id, status:20}) -- confirmado contra la documentación
            // oficial de Bybit (/v5/p2p/ad/update-list-ad): ese endpoint NO
            // tiene ningún parámetro "status", solo actionType ("MODIFY" o
            // "ACTIVE"). Esa llamada nunca hizo nada (fallaba en silencio,
            // atrapada en el catch vacío) -- removeAd (el borrado real, de
            // abajo) es el único paso que de verdad importa acá.
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
                // Mismo parámetro inválido que arriba (status no existe en
                // updateAd) -- se quita porque nunca hizo nada; postFields ya
                // incluye status:10 en la creación misma, y confirmado en
                // vivo que el anuncio nuevo queda online sin este paso extra.
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
          if (e.message?.includes("912120050") && !(await claimBybitRecreateLock(managedAd.id))) {
            await log( "debug", "bybit", `Ad ${adId}: otra ejecución ya está recreando este anuncio tras rate limit, se salta`);
          } else if (e.message?.includes("912120050")) {
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

    // 6. Sync orders from Bybit to local DB
    // IMPORTANTE: `o.amount` de Bybit es el monto en FIAT (CLP), no la
    // cantidad de USDT -- la cantidad real de cripto viene en
    // `o.notifyTokenQuantity`. Guardar `o.amount` como si fuera USDT y
    // multiplicarlo de nuevo por el precio (bug anterior) inflaba el total en
    // CLP cientos de veces (confirmado en vivo: una orden real de ~100.000
    // CLP quedaba guardada como ~95.000.000 CLP).
    //
    // También se actualiza (no solo crea) cada orden ya conocida: antes solo
    // se guardaba una vez, en el momento en que Bybit la mostraba por primera
    // vez (normalmente "pending"), y nunca se refrescaba su estado real —
    // una orden que se completaba después quedaba congelada como "pending"
    // para siempre en nuestra copia local, aunque en Bybit ya estuviera
    // completada. Esto rompía el Ciclo de Ventas (solo cuenta "completed").
    let bybitOrders: any[] = [];
    try {
      const ordersRes = await client.getOrders({ page: 1, size: 30 });
      bybitOrders = ordersRes?.result?.items || [];
      for (const o of bybitOrders) {
        const data = {
          tenantId, exchange: "bybit", orderNumber: o.id,
          tradeType: o.side === 0 ? "BUY" : "SELL",
          asset: o.tokenId || "USDT", fiat: o.currencyId || "CLP",
          amount: Number(o.notifyTokenQuantity) || 0,
          totalPrice: Number(o.amount) || 0,
          unitPrice: Number(o.price) || 0,
          status: bybitOrderStatusLabel(Number(o.status)),
          counterparty: o.targetNickName || "",
          executedAt: new Date(Number(o.createDate)),
        };
        const existing = await prisma.p2PBotOrder.findFirst({
          where: { tenantId, orderNumber: o.id, exchange: "bybit" },
        });
        if (existing) {
          if (existing.status !== data.status) {
            await prisma.p2PBotOrder.update({ where: { id: existing.id }, data: { status: data.status } });
          }
        } else {
          await prisma.p2PBotOrder.create({ data });
        }
      }
    } catch (e: any) {}

    await log( "info", "bybit", `Ciclo completado: ${bybitOrders.length} órdenes, managedAds: ${managedAds.length}`);

    try {
      await autoCloseCycle(prisma, tenantId, label, client, log, "bybit");
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
  log: (level: string, exchange: string | null, message: string) => Promise<void>,
  exchange: string = "binance"
) {
  const cycle = await prisma.p2PCycle.findFirst({
    where: { tenantId, exchange, label, status: "active" },
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
  let hasPending: boolean;
  let recentOrders: any[] = [];
  if (exchange === "binance") {
    const FINAL_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELLED_BY_SYSTEM"]);
    const recentOrdersRes = await client.getOrders({ page: 1, rows: 20 });
    recentOrders = recentOrdersRes?.data || [];
    hasPending = recentOrders.some((o: any) => !FINAL_ORDER_STATUSES.has(o.orderStatus));
  } else {
    // Bybit (y cualquier otro exchange sin historial propio integrado acá)
    // usa su propio esquema de estados numéricos — bybitOrderGroup ya sabe
    // traducirlos a pending/completed/cancelled.
    const recentOrdersRes = await client.getOrders({ page: 1, size: 20 });
    recentOrders = recentOrdersRes?.result?.items || [];
    hasPending = recentOrders.some((o: any) => bybitOrderGroup(Number(o.status)) === "pending");
  }
  if (hasPending) {
    await log( "info", null, `Auto-close: saldo bajo (${balance}) pero hay orden(es) pendiente(s) sin resolver — se espera a que se resuelvan antes de cerrar el ciclo ${cycle.id}`);
    return;
  }

  await log( "info", null, `Auto-cerrando ciclo ${cycle.id}: balance USDT=${balance}, minClose=${minClose}`);

  const startMs = Number(cycle.startTime);
  const endMs = Date.now();
  const { totalUsdt, totalBinanceClp, firstOrder, lastOrder, orders } =
    exchange === "binance"
      ? await computeCycleOrderStats(client, startMs, endMs, recentOrders)
      : await computeLocalCycleStats(prisma, tenantId, exchange, startMs, endMs);

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
      // Ver mismo comentario en app/api/p2p/cycle/close/route.ts -- guarda la
      // lista exacta que generó los totales de arriba, para que el detalle
      // del ciclo cerrado no dependa de volver a preguntarle a Binance.
      ordersJson: mapCycleOrdersForDisplay(orders),
    },
  });

  await log( "info", null, `Ciclo ${cycle.id} cerrado automáticamente: ${totalUsdt} USDT, ${totalBinanceClp + totalManualClp} CLP`);
}
