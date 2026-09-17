import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendTelegramAlert } from "@/lib/telegram-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

// Cada alerta tiene su propia llave de cooldown -- no reavisa la MISMA falla
// antes de que pase este tiempo, aunque el cron corra cada 5 min. Se
// reactiva sola en cuanto el problema deja de detectarse (ver
// clearCooldown), así que la próxima vez que reaparezca avisa de inmediato.
const COOLDOWN_MS = 20 * 60 * 1000; // 20 min

async function alertOnce(key: string, message: string) {
  const existing = await prisma.systemAlertCooldown.findUnique({ where: { key } });
  const now = Date.now();
  if (existing && now - existing.lastAlertedAt.getTime() < COOLDOWN_MS) return;

  await sendTelegramAlert(message);
  await prisma.systemAlertCooldown.upsert({
    where: { key },
    create: { key, lastAlertedAt: new Date() },
    update: { lastAlertedAt: new Date() },
  });
}

async function clearCooldown(key: string) {
  await prisma.systemAlertCooldown.deleteMany({ where: { key } });
}

const STALE_BOT_MINUTES = 5;
const BINANCE_ERROR_THRESHOLD = 5;
const BINANCE_ERROR_WINDOW_MINUTES = 10;
const SKIPO_ERROR_THRESHOLD = 3;
const SKIPO_ERROR_WINDOW_MINUTES = 15;
const CAPACITY_CLUSTER_MINUTES = 15;
const CAPACITY_CLUSTER_MIN_SIZE = 3;

// 1) Bot detenido: cuentas con el bot prendido (P2PBotExchangeConfig.enabled)
// que no generaron NINGÚN log en los últimos minutos -- el problema más
// repetido de toda la sesión (Hector, cortes de ciclo, cambios de pestaña
// ONZE/ZINPLE, etc, ver AGENTS.md puntos 6 y 7).
async function checkStalledBots() {
  const configs = await prisma.p2PBotExchangeConfig.findMany({
    where: { enabled: true },
    select: { tenantId: true, label: true, exchange: true },
  });
  const cutoff = new Date(Date.now() - STALE_BOT_MINUTES * 60 * 1000);

  for (const c of configs) {
    const key = `stalled:${c.tenantId}:${c.label}:${c.exchange}`;
    const recent = await prisma.p2PBotLog.findFirst({
      where: { tenantId: c.tenantId, label: c.label, exchange: c.exchange, createdAt: { gte: cutoff } },
      select: { id: true },
    });
    if (recent) {
      await clearCooldown(key);
      continue;
    }
    await alertOnce(
      key,
      `🔴 Bot detenido\n\nCuenta: ${c.label} (tenant ${c.tenantId}, ${c.exchange})\nLleva más de ${STALE_BOT_MINUTES} min sin generar actividad, aunque figura prendida.`
    );
  }
}

// 2) Errores de Binance en racha (-2015, 187049, 187040) por cuenta.
async function checkBinanceErrorSpikes() {
  const cutoff = new Date(Date.now() - BINANCE_ERROR_WINDOW_MINUTES * 60 * 1000);
  const errorLogs = await prisma.p2PBotLog.findMany({
    where: {
      createdAt: { gte: cutoff },
      level: { in: ["error", "warn"] },
      OR: [
        { message: { contains: "2015" } },
        { message: { contains: "187049" } },
        { message: { contains: "187040" } },
      ],
    },
    select: { tenantId: true, label: true, message: true },
  });

  const byAccount = new Map<string, { tenantId: number; label: string | null; count: number }>();
  for (const l of errorLogs) {
    const k = `${l.tenantId}:${l.label}`;
    const entry = byAccount.get(k) || { tenantId: l.tenantId, label: l.label, count: 0 };
    entry.count++;
    byAccount.set(k, entry);
  }

  for (const [k, entry] of byAccount) {
    const key = `binance-errors:${k}`;
    if (entry.count < BINANCE_ERROR_THRESHOLD) {
      await clearCooldown(key);
      continue;
    }
    await alertOnce(
      key,
      `🟠 Errores de Binance en racha\n\nCuenta: ${entry.label} (tenant ${entry.tenantId})\n${entry.count} errores (-2015/187049/187040) en los últimos ${BINANCE_ERROR_WINDOW_MINUTES} min.`
    );
  }
}

// 3) Fallas de Skipo -- alimentado por SystemAlertLog (ver lib/skipo-adapter.ts).
async function checkSkipoFailures() {
  const cutoff = new Date(Date.now() - SKIPO_ERROR_WINDOW_MINUTES * 60 * 1000);
  const count = await prisma.systemAlertLog.count({
    where: { source: "skipo", createdAt: { gte: cutoff } },
  });
  const key = "skipo-errors";
  if (count < SKIPO_ERROR_THRESHOLD) {
    await clearCooldown(key);
    return;
  }
  await alertOnce(
    key,
    `🟠 Fallas de Skipo (compra de USDT)\n\n${count} errores en los últimos ${SKIPO_ERROR_WINDOW_MINUTES} min.`
  );
}

// 4) Anomalía de capacity: varios capacities completándose EXACTAMENTE al
// mismo instante -- la misma firma del bug real confirmado en vivo (sep
// 2026, ver commit "fix: fecha de capacity completados usaba el momento
// del codigo, no el real"). Si vuelve a pasar, es señal de que algo está
// "descubriendo" capacities viejos de golpe otra vez.
async function checkCapacityClusters() {
  const cutoff = new Date(Date.now() - CAPACITY_CLUSTER_MINUTES * 60 * 1000);
  const recent = await prisma.p2PCapacity.findMany({
    where: { status: "finished", finishedAt: { gte: cutoff } },
    select: { id: true, tenantId: true, finishedAt: true },
  });

  const byTs = new Map<string, number>();
  for (const c of recent) {
    const ts = c.finishedAt!.toISOString();
    byTs.set(ts, (byTs.get(ts) || 0) + 1);
  }

  let maxCluster = 0;
  let maxTs = "";
  for (const [ts, count] of byTs) {
    if (count > maxCluster) { maxCluster = count; maxTs = ts; }
  }

  const key = "capacity-cluster";
  if (maxCluster < CAPACITY_CLUSTER_MIN_SIZE) {
    await clearCooldown(key);
    return;
  }
  await alertOnce(
    key,
    `🟡 Anomalía de capacity\n\n${maxCluster} capacities se completaron exactamente al mismo instante (${maxTs}) -- revisar si es un patrón real o un bug de re-cálculo.`
  );
}

// Disparado cada 5 min por el cron de Vercel (ver vercel.json).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const errors: string[] = [];
  for (const check of [checkStalledBots, checkBinanceErrorSpikes, checkSkipoFailures, checkCapacityClusters]) {
    try {
      await check();
    } catch (e: any) {
      errors.push(`${check.name}: ${e?.message || e}`);
    }
  }

  return NextResponse.json({ ok: true, errors: errors.length ? errors : undefined });
}
