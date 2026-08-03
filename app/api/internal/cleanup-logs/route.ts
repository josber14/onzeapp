import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 3;
const BATCH_SIZE = 5000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

// Disparado por el cron diario de Vercel (ver vercel.json) -- borra logs y
// snapshots de mercado del bot más viejos que RETENTION_DAYS. Nunca toca
// tablas de dinero/negocio (capacity, ventas, órdenes, cuentas) -- solo
// P2PBotLog/P2PBotMarketSnapshot, que son pura telemetría operativa sin
// valor contable. Confirmado ago 2026: la base llegó a ~1.960 MB, el 99%
// eran estos logs (8M+ filas) sin ninguna limpieza automática desde que el
// bot arrancó (10 jul 2026). Borrado en lotes (no un DELETE gigante) para no
// mantener una transacción larga bloqueando al bot en vivo.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const startedAt = Date.now();
  const maxMs = 50000; // deja margen dentro del límite de 60s de la función

  let deletedLogs = 0;
  while (Date.now() - startedAt < maxMs) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "P2PBotLog" WHERE id IN (
        SELECT id FROM "P2PBotLog" WHERE "createdAt" < ${cutoff} LIMIT ${BATCH_SIZE}
      )
    `;
    deletedLogs += Number(deleted);
    if (Number(deleted) < BATCH_SIZE) break;
  }

  let deletedSnapshots = 0;
  while (Date.now() - startedAt < maxMs) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "P2PBotMarketSnapshot" WHERE id IN (
        SELECT id FROM "P2PBotMarketSnapshot" WHERE "cycleAt" < ${cutoff} LIMIT ${BATCH_SIZE}
      )
    `;
    deletedSnapshots += Number(deleted);
    if (Number(deleted) < BATCH_SIZE) break;
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    deletedLogs,
    deletedSnapshots,
    durationMs: Date.now() - startedAt,
  });
}
