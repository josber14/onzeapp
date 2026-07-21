import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getRpIdAndOrigin, buildAuthenticationOptions } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Genera el challenge de autenticación (huella) atado a UNA orden puntual —
// el resultado exitoso de auth-verify solo sirve para liberar ESA orden.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orderNumber = String(body?.orderNumber || "");
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber" }, { status: 400 });
  }
  const { rpID } = getRpIdAndOrigin(req);
  const result = await buildAuthenticationOptions({ tenantId: session.tenantId, rpID, orderNumber });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, options: result.options });
}
