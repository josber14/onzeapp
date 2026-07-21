import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getRpIdAndOrigin, verifyAuthentication } from "@/lib/webauthn";
import { issueReleaseAuthToken } from "@/lib/security-pin";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Verifica la huella para UNA orden puntual — si es válida, emite el MISMO
// tipo de token corto de un solo uso que emite el camino del PIN
// (issueReleaseAuthToken), así el endpoint real de liberación no necesita
// saber por cuál de los dos caminos se autorizó.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orderNumber = String(body?.orderNumber || "");
  if (!orderNumber || !body?.response) {
    return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 });
  }
  const { origin, rpID } = getRpIdAndOrigin(req);
  const result = await verifyAuthentication({
    tenantId: session.tenantId,
    rpID,
    origin,
    orderNumber,
    response: body.response,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }
  const token = await issueReleaseAuthToken(session.tenantId, orderNumber);
  return NextResponse.json({ ok: true, token });
}
