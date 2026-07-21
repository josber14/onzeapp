import { NextResponse } from "next/server";
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

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const client = new SkipoClient();
    const balances = await client.getBalances();
    return NextResponse.json({ ok: true, balances });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo consultar el saldo" }, { status: 502 });
  }
}
