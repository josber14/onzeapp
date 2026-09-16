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

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const client = new SkipoV2Client();
    const balances = await client.getBalances();
    // "currency" (no "assetSymbol") -- así lo lee el frontend
    // (window.skipoLoadBalances en onze-panel.html), sin tocarlo.
    return NextResponse.json({
      ok: true,
      balances: balances.map((b) => ({
        currency: b.assetSymbol,
        balance: b.balance,
        balanceFrozen: b.balanceFrozen,
        balancePending: b.balancePending,
        balanceUSD: b.balanceUSD,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo consultar el saldo" }, { status: 502 });
  }
}
