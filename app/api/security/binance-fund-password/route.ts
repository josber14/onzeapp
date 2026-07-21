import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { setBinanceFundPassword, hasBinanceFundPassword } from "@/lib/binance-fund-password";
import { requireSettingsAuthIfConfigured } from "@/lib/security-pin";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const label = req.nextUrl.searchParams.get("label") || "ONZE";
  const configured = await hasBinanceFundPassword(session.tenantId, label);
  return NextResponse.json({ ok: true, configured });
}

// Si ya hay una huella registrada, cambiar la contraseña de fondos exige
// verificarla primero — mismo motivo que el cambio de PIN (ver
// requireSettingsAuthIfConfigured): evita que alguien con la sesión del
// panel abierta pueda reemplazar esta credencial sin el dedo del dueño.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const label = String(body?.label || "ONZE");
  const fundPassword = String(body?.fundPassword || "");
  if (!fundPassword) {
    return NextResponse.json({ ok: false, error: "Ingresa la contraseña de fondos" }, { status: 400 });
  }

  const settingsAuth = await requireSettingsAuthIfConfigured(session.tenantId, body?.token);
  if (!settingsAuth.ok) {
    return NextResponse.json({ ok: false, error: settingsAuth.error }, { status: 401 });
  }

  try {
    await setBinanceFundPassword(session.tenantId, label, fundPassword);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo guardar" }, { status: 400 });
  }
}
