import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pedido explícito del usuario (ago 2026): poder cambiar el monto mínimo de
// auto-cierre del ciclo YA ACTIVO, sin tener que cerrarlo y volver a
// iniciarlo (antes solo se podía fijar una vez, al arrancar el ciclo, en
// app/api/p2p/cycle/start/route.ts).
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const body = await req.json().catch(() => ({}));
    const label = body.label || "ONZE";
    const exchange = body.exchange || "binance";
    const minCloseBalance = Number(body.minCloseBalance);
    if (!Number.isFinite(minCloseBalance) || minCloseBalance < 0) {
      return Response.json({ ok: false, error: "Monto inválido" }, { status: 400 });
    }

    const cycle = await prisma.p2PCycle.findFirst({
      where: { tenantId, exchange, label, status: "active" },
    });
    if (!cycle) {
      return Response.json({ ok: false, error: "No hay ciclo activo para esta cuenta" }, { status: 404 });
    }

    const updated = await prisma.p2PCycle.update({
      where: { id: cycle.id },
      data: { minCloseBalance },
    });

    return Response.json({ ok: true, cycle: updated });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
