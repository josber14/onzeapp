import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { SkipoClient } from "@/lib/skipo-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  if (session.role !== "super_admin_global" && session.role !== "super_admin_cliente") {
    return { error: NextResponse.json({ error: "No tienes permisos." }, { status: 403 }) };
  }
  return { session };
}

// Ejecuta la compra real — pedido explícito del usuario (jul 2026): sin
// PIN ni huella para este flujo puntual, solo la sesión de admin ya
// existente (requireAdmin).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const ordId = String(body.ordId || "");
  if (!ordId) return NextResponse.json({ ok: false, error: "Falta ordId" }, { status: 400 });

  try {
    const client = new SkipoClient();
    const result = await client.confirmQuotation(ordId);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo confirmar la compra" }, { status: 502 });
  }
}
