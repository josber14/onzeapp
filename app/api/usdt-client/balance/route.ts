import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { getClientAvailableUsdt } from "@/lib/usdt-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saldo disponible real: compras completadas menos retiros que ya
// comprometieron el saldo (ver getClientAvailableUsdt en lib/usdt-purchase.ts).
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const available = await getClientAvailableUsdt(session.tenantId, session.clientId);
  return NextResponse.json({ ok: true, availableUsdt: available });
}
