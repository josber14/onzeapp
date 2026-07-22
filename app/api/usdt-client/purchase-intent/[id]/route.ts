import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Consultado en polling por la pantalla de comprar mientras espera el pago —
// solo devuelve el estado/monto, nunca ejecuta nada.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const intent = await prisma.usdtPurchaseIntent.findUnique({ where: { id: Number(id) } });
  if (!intent || intent.clientId !== session.clientId || intent.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, intent });
}

// Cancela una solicitud que el cliente ya no quiere seguir esperando — solo
// mientras sigue en awaiting_payment. Una vez que hay plata real asociada
// (ready_to_buy o más adelante) no se puede cancelar desde acá, para no
// perder de vista un pago que ya llegó.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const intent = await prisma.usdtPurchaseIntent.findUnique({ where: { id: Number(id) } });
  if (!intent || intent.clientId !== session.clientId || intent.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }
  if (intent.status !== "awaiting_payment") {
    return NextResponse.json({ ok: false, error: "Ya no se puede cancelar — contáctanos si necesitas ayuda" }, { status: 400 });
  }

  const updated = await prisma.usdtPurchaseIntent.update({ where: { id: intent.id }, data: { status: "cancelled" } });
  return NextResponse.json({ ok: true, intent: updated });
}
