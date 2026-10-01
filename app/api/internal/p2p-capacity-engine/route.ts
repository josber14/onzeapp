import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { processTenantCapacityEngine } from "@/lib/p2p-capacity-engine";

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

// Disparado cada 30 min por el cron de Vercel (ver vercel.json) -- es solo
// el RESPALDO periódico. El disparo principal ahora es inmediato, justo
// después de que entra una venta real o manual (ver triggerCapacityEngineNow
// en lib/p2p-capacity-engine.ts, llamado desde /api/p2p/manual-sale y desde
// la sincronización de órdenes reales) -- pedido explícito del usuario (oct
// 2026): "no se puede quedar ese capacity ahí de primero si ya se completó,
// tiene que ir a completado de una". Este cron sigue existiendo para
// agarrar cualquier caso que el disparo inmediato se haya perdido (ej. un
// error de red puntual), no como el único mecanismo.
//
// Ver AGENTS.md, sección "Motor de Capacity del lado del servidor" -- por
// defecto corre en modo sombra (TenantSettings.p2pCapacityServerAuthority =
// false) para todos los tenants: calcula qué capacity marcaría como
// completado y solo lo anota en P2PCapacityEngineLog, sin tocar Neon. Recién
// actúa de verdad para un tenant cuando ese interruptor se prende a mano.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const tenantIds = await prisma.p2PCapacity
    .findMany({ select: { tenantId: true }, distinct: ["tenantId"] })
    .then((rows) => rows.map((r) => r.tenantId));

  const results = [];
  for (const tenantId of tenantIds) {
    try {
      results.push(await processTenantCapacityEngine(tenantId));
    } catch (e: any) {
      results.push({ tenantId, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
