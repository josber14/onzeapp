import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { verifyReleasePin, issueReleaseAuthToken } from "@/lib/security-pin";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Verifica la clave de 4 dígitos para UNA orden puntual — si es correcta,
// emite un token corto (2 min) atado a esa orden específica, que es lo
// único que el endpoint real de liberación acepta como autorización.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const pin = String(body?.pin || "");
  const orderNumber = String(body?.orderNumber || "");
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber" }, { status: 400 });
  }

  const result = await verifyReleasePin(session.tenantId, pin);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }

  const token = await issueReleaseAuthToken(session.tenantId, orderNumber);
  return NextResponse.json({ ok: true, token });
}
