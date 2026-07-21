import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_NETWORKS = ["TRC20", "ERC20", "BEP20"];

// Autoservicio: el cliente edita solo su dirección de retiro y la red — el
// resto de su perfil (correo, nombre legal) viene del KYC y no se cambia acá.
export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.trim() : undefined;
  const withdrawalNetwork = typeof body.withdrawalNetwork === "string" ? body.withdrawalNetwork.trim() : undefined;

  if (withdrawalNetwork && !VALID_NETWORKS.includes(withdrawalNetwork)) {
    return NextResponse.json({ ok: false, error: "Protocolo inválido" }, { status: 400 });
  }

  const updated = await prisma.usdtClient.update({
    where: { id: client.id },
    data: {
      ...(walletAddress !== undefined ? { walletAddress: walletAddress || null } : {}),
      ...(withdrawalNetwork !== undefined ? { withdrawalNetwork: withdrawalNetwork || null } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    client: { walletAddress: updated.walletAddress, withdrawalNetwork: updated.withdrawalNetwork },
  });
}
