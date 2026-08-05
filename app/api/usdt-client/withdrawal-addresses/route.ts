import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Direcciones de retiro que el ADMIN ya precargó para este cliente -- nunca
// se expone providerContactId (identificador interno del proveedor) acá.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const addresses = await prisma.usdtWithdrawalAddress.findMany({
    where: { tenantId: session.tenantId, clientId: session.clientId, active: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, alias: true, assetSymbol: true, networkSymbol: true, address: true },
  });
  return NextResponse.json({ ok: true, addresses });
}
