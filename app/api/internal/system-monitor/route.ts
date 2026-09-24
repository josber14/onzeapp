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
const COOLDOWN_MS = 20 * 60 * 1000; // 20 min -- default para fallas que pueden resolverse solas pronto
const SLOW_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h -- para condiciones que no cambian rápido (ej. ciclo atascado), para no repetir el mismo aviso cada 20 min sin necesidad

async function alertOnce(key: string, message: string, cooldownMs: number = COOLDOWN_MS) {
  const existing = await prisma.systemAlertCooldown.findUnique({ where: { key } });
  const now = Date.now();
  if (existing && now - existing.lastAlertedAt.getTime() < cooldownMs) return;

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
const CYCLE_STUCK_HOURS = 48; // calibrado con datos reales: ciclos normales cierran en 1-24h
const CYCLE_ERROR_WINDOW_MINUTES = 30;

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

// 4.5) Cuenta sin NINGÚN capacity activo: mientras dure esta ventana, toda
// venta real que entre queda "sin asignar" (ver "Ventas sin compra/capacity
// detectadas" en el panel) -- comportamiento esperado (pedido explícito del
// usuario, sep 2026: "la única forma en que eso puede aparecer es si entran
// ventas y no existe un capacity activo"), pero el usuario solo se enteraba
// mirando el panel, después de que ya se habían acumulado decenas de ventas
// sin cubrir. Este aviso llega apenas se detecta el hueco (máximo 5 min de
// atraso, el ciclo del cron) para que pueda registrar el siguiente capacity
// al toque, en vez de descubrirlo tarde. Solo se chequean tenants que ya
// usan el módulo de capacity (al menos un P2PCapacity alguna vez) -- no
// tiene sentido avisar a una cuenta que nunca lo usó.
async function checkNoActiveCapacity() {
  const tenantIds = await prisma.p2PCapacity
    .findMany({ select: { tenantId: true }, distinct: ["tenantId"] })
    .then((rows) => rows.map((r) => r.tenantId));

  for (const tenantId of tenantIds) {
    const key = `no-active-capacity:${tenantId}`;
    const activeCount = await prisma.p2PCapacity.count({ where: { tenantId, status: "active" } });
    if (activeCount > 0) {
      await clearCooldown(key);
      continue;
    }
    await alertOnce(
      key,
      `🟡 Sin capacity activo\n\nTenant ${tenantId} se quedó sin ningún capacity "active" -- cualquier venta real que entre ahora va a quedar "sin asignar" hasta que se registre uno nuevo. Revisar el panel de Capacity.`
    );
  }
}

// 5) Ciclo de ventas atascado: un ciclo "active" que lleva mucho más tiempo
// abierto que lo normal (1-24h según los últimos cierres reales) suele
// significar que autoCloseCycle() dejó de correr para esa cuenta o quedó
// trabado -- confirmado en vivo (sep 2026): 2 ciclos reales llevaban 38 y
// 54 DÍAS abiertos sin que nadie se diera cuenta.
async function checkStuckCycles() {
  const cutoff = new Date(Date.now() - CYCLE_STUCK_HOURS * 60 * 60 * 1000);
  const stuck = await prisma.p2PCycle.findMany({
    where: { status: "active", startTime: { lt: cutoff } },
    select: { id: true, tenantId: true, label: true, exchange: true, startTime: true },
  });

  for (const c of stuck) {
    const key = `stuck-cycle:${c.id}`;
    const hours = Math.round((Date.now() - c.startTime.getTime()) / 3600000);
    await alertOnce(
      key,
      `🔴 Ciclo de ventas atascado\n\nCiclo #${c.id} (${c.label}, tenant ${c.tenantId}, ${c.exchange}) lleva ${hours}h abierto -- lo normal es que cierre en 1-24h. Revisar si autoCloseCycle sigue corriendo para esta cuenta.`,
      SLOW_COOLDOWN_MS
    );
  }
}

// 6) Errores REALES (excepciones) en el cierre automático del ciclo -- ver
// engine.ts, autoCloseCycle envuelto en try/catch que loguea con este
// prefijo exacto. Distinto del mensaje normal "orden(es) pendiente(s) sin
// resolver" (que es informativo, no un bug).
async function checkCycleErrors() {
  const cutoff = new Date(Date.now() - CYCLE_ERROR_WINDOW_MINUTES * 60 * 1000);
  const errorLogs = await prisma.p2PBotLog.findMany({
    where: { createdAt: { gte: cutoff }, message: { startsWith: "Auto-close cycle check:" } },
    select: { tenantId: true, label: true, exchange: true, message: true },
  });
  if (!errorLogs.length) {
    await clearCooldown("cycle-errors");
    return;
  }

  const byAccount = new Map<string, { tenantId: number; label: string | null; exchange: string | null; count: number; sample: string }>();
  for (const l of errorLogs) {
    const k = `${l.tenantId}:${l.label}:${l.exchange}`;
    const entry = byAccount.get(k) || { tenantId: l.tenantId, label: l.label, exchange: l.exchange, count: 0, sample: l.message };
    entry.count++;
    byAccount.set(k, entry);
  }

  for (const [k, entry] of byAccount) {
    await alertOnce(
      `cycle-errors:${k}`,
      `🔴 Error real en el cierre del ciclo de ventas\n\nCuenta: ${entry.label} (tenant ${entry.tenantId}, ${entry.exchange})\n${entry.count} error(es) en los últimos ${CYCLE_ERROR_WINDOW_MINUTES} min.\nÚltimo: ${entry.sample.slice(0, 200)}`
    );
  }
}

// Disparado cada 5 min por el cron de Vercel (ver vercel.json).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const errors: string[] = [];
  for (const check of [checkStalledBots, checkBinanceErrorSpikes, checkSkipoFailures, checkCapacityClusters, checkNoActiveCapacity, checkStuckCycles, checkCycleErrors]) {
    try {
      await check();
    } catch (e: any) {
      errors.push(`${check.name}: ${e?.message || e}`);
    }
  }

  return NextResponse.json({ ok: true, errors: errors.length ? errors : undefined });
}
