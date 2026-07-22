import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solo para mostrarle al cliente cómo se ha movido el precio recientemente
// — nunca se usa para ejecutar una compra (esas siempre piden una
// cotización fresca).
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const ticks = await prisma.usdtPriceTick.findMany({
    where: { tenantId: session.tenantId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { rate: true, createdAt: true },
  });

  return NextResponse.json({
    ok: true,
    ticks: ticks.map((t) => ({ rate: Number(t.rate), createdAt: t.createdAt })),
  });
}
