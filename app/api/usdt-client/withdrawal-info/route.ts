import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { SkipoV2Client } from "@/lib/skipo-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mínimo/comisión de retiro reales, para mostrar en la pantalla de "ingresa
// la cantidad" antes de que el cliente escriba nada -- pedido explícito del
// usuario (ago 2026), igual que la app de Skipo. Es info pública del activo,
// no expone nada del proveedor.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  try {
    const skipoClient = new SkipoV2Client();
    const info = await skipoClient.getAssetInfo("USDT");
    return NextResponse.json({
      ok: true,
      minimumWithdrawal: Number(info.minimumWithdrawal),
      withdrawalFee: Number(info.withdrawalFee),
    });
  } catch (e: any) {
    console.error(`[WithdrawalInfo] ${e.message}`);
    return NextResponse.json({ ok: false, error: "No se pudo obtener la información de retiro" }, { status: 502 });
  }
}
