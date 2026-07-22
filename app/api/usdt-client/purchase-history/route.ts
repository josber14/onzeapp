import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historial de compras YA completadas del cliente que tiene la sesión —
// nunca muestra las de otros clientes.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const intents = await prisma.usdtPurchaseIntent.findMany({
    where: { clientId: session.clientId, tenantId: session.tenantId, status: "completed" },
    orderBy: { executedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    purchases: intents.map((i) => ({
      id: i.id,
      requestedClp: Number(i.requestedClp),
      receivedClp: Number(i.receivedClp),
      usdtAmount: i.usdtAmount ? Number(i.usdtAmount) : null,
      executedRate: i.executedRate ? Number(i.executedRate) : null,
      executedAt: i.executedAt,
    })),
  });
}
