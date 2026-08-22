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
  const errors: string[] = [];

  try {
    while (Date.now() - startedAt < RUN_BUDGET_MS) {
      const configs = await prisma.p2PBotExchangeConfig.findMany({
        where: { enabled: true },
        select: { tenantId: true, label: true },
      });

      if (configs.length === 0) break; // nada prendido, no vale la pena seguir loopeando

      const pairs = Array.from(new Set(configs.map((c) => `${c.tenantId}:${c.label}`))).map((k) => {
        const [tenantIdStr, label] = k.split(":");
        return { tenantId: Number(tenantIdStr), label };
      });

      for (const { tenantId, label } of pairs) {
        if (Date.now() - startedAt >= RUN_BUDGET_MS) break;
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
    durationMs: Date.now() - startedAt,
    errors: errors.length ? errors.slice(0, 10) : undefined,
  });
}
