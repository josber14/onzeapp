import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

// Utilidad de diagnóstico: qué IP de salida usa el servidor de Vercel al
// llamar a servicios externos (Binance/Bybit) -- útil para confirmar qué IP
// whitelistear en la configuración de las API keys de los exchanges, ya que
// Vercel no expone esto directamente en su dashboard.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return NextResponse.json({ ok: true, outboundIp: data.ip, region: process.env.VERCEL_REGION || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
