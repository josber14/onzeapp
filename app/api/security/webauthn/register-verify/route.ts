import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getRpIdAndOrigin, verifyRegistration } from "@/lib/webauthn";
import { requireSettingsAuthIfConfigured } from "@/lib/security-pin";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Si ya hay una huella registrada, agregar OTRA exige verificar con una
  // huella existente primero (mismo motivo que en el cambio de PIN) — si
  // no, alguien con la sesión abierta podría agregar SU propia huella y
  // quedarse con acceso permanente para liberar órdenes.
  const settingsAuth = await requireSettingsAuthIfConfigured(session.tenantId, body?.token);
  if (!settingsAuth.ok) {
    return NextResponse.json({ ok: false, error: settingsAuth.error }, { status: 401 });
  }

  const { origin, rpID } = getRpIdAndOrigin(req);
  const result = await verifyRegistration({
    tenantId: session.tenantId,
    rpID,
    origin,
    response: body?.response,
    deviceLabel: typeof body?.deviceLabel === "string" ? body.deviceLabel : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
