import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { executeBotCycle } from "@/lib/p2p-bot/engine";

// Nota jul 2026: este archivo se tocó a propósito (sin cambiar lógica) para
// forzar que Vercel recompile esta función serverless específica — parecía
// estar reusando un paquete viejo de ESTA ruta (no cambiaba de archivo
// directamente en los commits recientes) aunque sus dependencias (engine.ts,
// chat-agent.ts, chat-lock.ts) sí se habían actualizado.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const label = body.label || "ONZE";
    const force = body.force === true;

    const result = await executeBotCycle(session.tenantId, label, force);
    return Response.json(result);
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
