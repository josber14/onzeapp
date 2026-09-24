import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { executeBotCycle } from "@/lib/p2p-bot/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

const LOCK_ID = "bot-cycle";
const LOCK_STALE_MS = 70_000;
// Vercel Cron no dispara más seguido que 1 vez por minuto, pero el panel
// disparaba el ciclo del bot cada 1s mientras alguien lo tenía abierto. Para
// no perder tanta velocidad de reacción cuando nadie tiene el navegador
// abierto (pedido explícito del usuario, ago 2026: automatizar el bot para
// que corra solo mientras viaja), esta ruta no hace un solo ciclo y termina
// -- se queda corriendo en loop casi todo el minuto, dejando margen antes de
// que llegue el siguiente disparo del cron.
const RUN_BUDGET_MS = 50_000;
const ROUND_DELAY_MS = 3_000;
// Si alguien tiene el panel abierto, el navegador ya está ciclando esa cuenta
// cada ~1s por su cuenta. Sin este chequeo, el cron repetía exactamente el
// mismo trabajo (mismas llamadas a Binance, mismo cálculo de precio) sin
// ganar nada -- solo pagando CPU/memoria dos veces. Si el último ciclo real
// de una cuenta (lastCycleAt, actualizado por CUALQUIER disparador dentro de
// executeBotCycle) fue hace menos de esto, se asume que ya está cubierta y
// esta vuelta se la salta.
const SKIP_IF_CYCLED_WITHIN_MS = 2_000;

async function acquireLock(): Promise<boolean> {
  await prisma.p2PCronLock.upsert({
    where: { id: LOCK_ID },
    create: { id: LOCK_ID, lockedAt: null },
    update: {},
  });
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);
  const result = await prisma.p2PCronLock.updateMany({
    where: { id: LOCK_ID, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    data: { lockedAt: now },
  });
  return result.count > 0;
}

async function releaseLock(): Promise<void> {
  await prisma.p2PCronLock.update({ where: { id: LOCK_ID }, data: { lockedAt: null } }).catch(() => {});
}

// Disparado cada 1 minuto por el cron de Vercel (ver vercel.json). Reemplaza
// al timer del navegador (scheduleBotCycle en public/onze-panel.html) como
// disparador del ciclo del bot cuando nadie tiene el panel abierto -- lee
// directamente de P2PBotExchangeConfig (enabled=true) qué combinaciones
// tenant+label están prendidas, sin depender de que el cliente se lo avise.
// Convive sin problema con el disparador del navegador si alguien SÍ tiene
// el panel abierto: el freno anti-bloqueo de Binance (lib/p2p-bot/rate-
// limiter.ts) ya está respaldado en base de datos, así que cuenta las
// llamadas sin importar quién las disparó.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const gotLock = await acquireLock();
  if (!gotLock) {
    return NextResponse.json({ ok: true, skipped: true, reason: "ya hay una invocación corriendo" });
  }

  const startedAt = Date.now();
  let rounds = 0;
  let cyclesRun = 0;
  let cyclesSkipped = 0;
  const errors: string[] = [];

  try {
    while (Date.now() - startedAt < RUN_BUDGET_MS) {
      // Pedido explícito del usuario (sep 2026): el historial de órdenes de
      // Binance (venta real -> P2PBotOrder) tiene que sincronizarse SIEMPRE,
      // esté o no prendido el bot de precio -- es una lectura por API, no
      // maneja precio. Antes esta consulta solo traía cuentas con
      // enabled=true, así que una cuenta con el bot apagado (ej. mientras se
      // investiga un error) nunca volvía a llamar a executeBotCycle -- ni el
      // navegador (si nadie clickeó "Iniciar") ni este cron la cubrían, y
      // ninguna venta real se sincronizaba hasta prender el bot de nuevo.
      // Ahora también se incluyen las cuentas de binance DESHABILITADAS
      // (executeBotCycle ya sabe, con su propio freno de 10s, sincronizar
      // solo el historial de órdenes sin tocar precio -- ver
      // syncBinanceOrdersOnly en engine.ts).
      const configs = await prisma.p2PBotExchangeConfig.findMany({
        where: { OR: [{ enabled: true }, { exchange: "binance" }] },
        select: { tenantId: true, label: true, lastCycleAt: true },
      });

      if (configs.length === 0) break; // nada configurado, no vale la pena seguir loopeando

      // Por par tenant+label, se queda con el lastCycleAt más reciente entre
      // sus exchanges habilitados -- si CUALQUIERA cicló hace muy poco, es
      // buena señal de que el navegador ya está cubriendo esta cuenta.
      const byPair = new Map<string, { tenantId: number; label: string; lastCycleAt: Date | null }>();
      for (const c of configs) {
        const key = `${c.tenantId}:${c.label}`;
        const existing = byPair.get(key);
        if (!existing || (c.lastCycleAt && (!existing.lastCycleAt || c.lastCycleAt > existing.lastCycleAt))) {
          byPair.set(key, { tenantId: c.tenantId, label: c.label, lastCycleAt: c.lastCycleAt });
        }
      }

      for (const { tenantId, label, lastCycleAt } of byPair.values()) {
        if (Date.now() - startedAt >= RUN_BUDGET_MS) break;
        if (lastCycleAt && Date.now() - lastCycleAt.getTime() < SKIP_IF_CYCLED_WITHIN_MS) {
          cyclesSkipped++;
          continue;
        }
        try {
          await executeBotCycle(tenantId, label);
          cyclesRun++;
        } catch (e: any) {
          errors.push(`tenant ${tenantId} (${label}): ${e?.message || e}`);
        }
      }

      rounds++;
      if (Date.now() - startedAt >= RUN_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, ROUND_DELAY_MS));
    }
  } finally {
    await releaseLock();
  }

  return NextResponse.json({
    ok: true,
    rounds,
    cyclesRun,
    cyclesSkipped,
    durationMs: Date.now() - startedAt,
    errors: errors.length ? errors.slice(0, 10) : undefined,
  });
}
