import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { SkipoV2Client } from "@/lib/skipo-adapter";

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

// Solo para el panel de ADMIN -- lista los contactos ya whitelisteados del
// lado del proveedor, para que el operador pueda elegir uno (en vez de
// copiar/pegar un id a mano, con riesgo de error en un campo que mueve
// dinero real) al registrar una dirección de retiro para un cliente. Nunca
// se expone al cliente (ver app/api/usdt-client/*).
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const client = new SkipoV2Client();
    const result = await client.getContacts();
    return NextResponse.json({ ok: true, contacts: result.data });
  } catch (e: any) {
    console.error(`[admin/skipo-contacts] ${e.message}`);
    return NextResponse.json({ ok: false, error: "No se pudo consultar los contactos del proveedor" }, { status: 502 });
  }
}
