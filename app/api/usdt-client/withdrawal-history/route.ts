import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historial de retiros del cliente que tiene la sesión -- nunca muestra los
// de otros clientes. Incluye todos los estados (pending/completed/failed/
// error), no solo los completados, para que el cliente vea si alguno falló.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const withdrawals = await prisma.usdtWithdrawal.findMany({
    where: { clientId: session.clientId, tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    include: { address: { select: { alias: true, networkSymbol: true, assetSymbol: true } } },
  });

  return NextResponse.json({
    ok: true,
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amountUsdt: Number(w.amountUsdt),
      totalUsdt: w.totalUsdt ? Number(w.totalUsdt) : null,
      status: w.status,
      addressAlias: w.address?.alias || null,
      networkSymbol: w.address?.networkSymbol || null,
      createdAt: w.createdAt,
      completedAt: w.completedAt,
    })),
  });
}
