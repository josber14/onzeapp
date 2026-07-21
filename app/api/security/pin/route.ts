import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { setReleasePin, hasReleasePin, requireSettingsAuthIfConfigured } from "@/lib/security-pin";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Solo dice si YA hay una clave configurada (nunca devuelve el hash ni nada
// que permita reconstruirla) — el panel lo usa para saber si mostrar
// "definir clave" o "cambiar clave".
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const configured = await hasReleasePin(session.tenantId);
  return NextResponse.json({ ok: true, configured });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const pin = String(body?.pin || "");

  // Si ya hay una huella registrada, exige verificarla antes de dejar
  // cambiar el PIN (ver requireSettingsAuthIfConfigured) — evita que alguien
  // con la sesión abierta pueda tomar el control de la protección sin tocar
  // el sensor de huella del dueño.
  const settingsAuth = await requireSettingsAuthIfConfigured(session.tenantId, body?.token);
  if (!settingsAuth.ok) {
    return NextResponse.json({ ok: false, error: settingsAuth.error }, { status: 401 });
  }

  const result = await setReleasePin(session.tenantId, pin);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
