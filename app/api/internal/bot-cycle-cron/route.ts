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
// -- se queda corriendo en loop, dejando margen antes de que llegue el
// siguiente disparo del cron.
//
// Bajado de 50s a 18s (sep 2026, pedido explícito del usuario -- factura de
// Vercel disparada: Fluid Provisioned Memory +527%, Fluid Active CPU +488%
// en la semana). Confirmado en vivo antes de este cambio: esta función
// corría activa ~50-60 de cada 60 segundos, 24/7, para TODOS los tenants
// juntos (no solo el que tenga el panel cerrado) -- y ~1 de cada 4
// invocaciones se pasaba del límite duro de 60s y terminaba en 504 (que
// igual se cobra completo). Con 18s el loop hace ~5-6 vueltas al principio
// de cada minuto en vez de ~16, dejando un hueco de ~40s sin corrección de
// precio SOLO para cuentas sin el panel abierto (con el panel abierto, el
// navegador sigue ciclando cada ~1s por su cuenta, sin cambios). No toca el
// candado (P2PCronLock) ni la lógica de precio -- solo acorta cuánto tiempo
// el while de abajo se queda dando vueltas antes de terminar normalmente.
const RUN_BUDGET_MS = 18_000;
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
    // Bug real confirmado en vivo (sep 2026, causó lentitud real en toda la
    // web): el arreglo de "sincronizar órdenes aunque el bot esté apagado"
    // (ver syncBinanceOrdersOnly en engine.ts) se implementó acá sumando las
    // cuentas de binance DESHABILITADAS a la MISMA consulta que alimenta el
    // loop rápido de abajo -- como esa consulta casi nunca queda vacía
    // (siempre hay alguna cuenta de binance configurada, prendida o no), el
    // `if (configs.length === 0) break` que antes cortaba el cron temprano
    // dejó de disparar casi nunca: el cron pasó a correr sus 50 segundos
    // completos, cada 1 minuto, sin parar, multiplicando la carga real del
    // servidor (más funciones de Vercel corriendo en simultáneo, más
    // consultas a la base compitiendo con las de usuarios reales).
    //
    // Arreglo: separar los dos trabajos. El loop rápido de abajo (cada 3s,
    // hasta 50s) sigue existiendo SOLO para cuentas con enabled=true, exacto
    // como antes -- si no hay ninguna, corta temprano igual que siempre. El
    // sync de cuentas deshabilitadas corre UNA sola vez por invocación del
    // cron (no 16 veces por minuto) -- de sobra para que una venta real
    // aparezca en minuto o dos, sin la carga de un loop continuo para algo
    // que no necesita esa velocidad.
    const disabledBinanceConfigs = await prisma.p2PBotExchangeConfig.findMany({
      where: { exchange: "binance", enabled: false },
      select: { tenantId: true, label: true },
    });
    for (const { tenantId, label } of disabledBinanceConfigs) {
      try {
        await executeBotCycle(tenantId, label);
      } catch (e: any) {
        errors.push(`sync-only tenant ${tenantId} (${label}): ${e?.message || e}`);
      }
    }

    while (Date.now() - startedAt < RUN_BUDGET_MS) {
      const configs = await prisma.p2PBotExchangeConfig.findMany({
        where: { enabled: true },
        select: { tenantId: true, label: true, lastCycleAt: true },
      });

      if (configs.length === 0) break; // nada prendido, no vale la pena seguir loopeando

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
