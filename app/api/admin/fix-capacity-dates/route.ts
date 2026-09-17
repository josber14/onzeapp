import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session) return { error: NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 }) };
  if (session.role !== "super_admin_global" && session.role !== "super_admin_cliente") {
    return { error: NextResponse.json({ ok: false, error: "No tienes permisos." }, { status: 403 }) };
  }
  return { session };
}

function lastSalePartTs(finalSaleParts: any): number {
  if (!Array.isArray(finalSaleParts) || finalSaleParts.length === 0) return 0;
  let max = 0;
  for (const p of finalSaleParts) {
    const t = new Date(p?.createdAt || 0).getTime();
    if (t > max) max = t;
  }
  return max;
}

function chileDayKey(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

// Endpoint TEMPORAL (sep 2026) para una corrección de datos única: 105
// capacities "finished" quedaron con finishedAt = el momento en que el
// código notó que ya estaban cubiertos (a veces días/semanas después),
// no la fecha real de su última venta -- bug ya corregido hacia adelante
// en autoFinishP2PCapacities() (onze-panel.html). Este endpoint corrige
// el historial existente: solo toca finishedAt, usando la fecha ya
// guardada en finalSaleParts de cada registro -- ningún monto cambia.
// Borrar este archivo (y el botón temporal en el panel) una vez confirmado
// que la corrección se aplicó bien en producción.
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const finished = await prisma.p2PCapacity.findMany({
    where: { status: "finished", finishedAt: { not: null } },
    select: { id: true, finishedAt: true, finalSaleParts: true },
  });

  const changes: { id: string; before: string; after: string }[] = [];
  for (const c of finished) {
    const lastTs = lastSalePartTs(c.finalSaleParts);
    if (lastTs === 0) continue;
    const currentTs = c.finishedAt!.getTime();
    if (chileDayKey(currentTs) === chileDayKey(lastTs)) continue;
    changes.push({ id: c.id, before: c.finishedAt!.toISOString(), after: new Date(lastTs).toISOString() });
  }

  for (const ch of changes) {
    await prisma.p2PCapacity.update({
      where: { id: ch.id },
      data: { finishedAt: new Date(ch.after) },
    });
  }

  return NextResponse.json({ ok: true, totalFinished: finished.length, fixed: changes.length, changes });
}
