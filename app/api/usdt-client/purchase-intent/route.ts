import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { generateReferenceCode } from "@/lib/usdt-purchase";
import { getUsdtPaymentAccount } from "@/lib/usdt-payment-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireClient() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return null;
  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) return null;
  return client;
}

// Crea una solicitud de compra: el cliente todavía NO puede comprar — recién
// puede apretar "Comprar" cuando su transferencia (identificada por el
// código de referencia que se genera acá) sea detectada y sume el monto
// pedido. Ver lib/usdt-payment-matcher.ts.
export async function POST(req: NextRequest) {
  const client = await requireClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  if (client.status !== "approved") {
    return NextResponse.json({ ok: false, error: "Tu cuenta no está aprobada todavía" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clpAmount = Number(body.clpAmount);
  if (!(clpAmount >= 500)) {
    return NextResponse.json({ ok: false, error: "El monto mínimo es 500 CLP" }, { status: 400 });
  }
  if (client.purchaseLimitClp !== null && clpAmount > Number(client.purchaseLimitClp)) {
    return NextResponse.json({ ok: false, error: `Superas tu límite de compra (${Number(client.purchaseLimitClp).toLocaleString("es-CL")} CLP)` }, { status: 400 });
  }

  // Reintenta si el código generado ya existe (colisión extremadamente rara
  // con el alfabeto de 32^6 combinaciones) en vez de fallar la solicitud.
  for (let attempt = 0; attempt < 5; attempt++) {
    const referenceCode = generateReferenceCode();
    try {
      const intent = await prisma.usdtPurchaseIntent.create({
        data: {
          tenantId: client.tenantId,
          clientId: client.id,
          referenceCode,
          requestedClp: clpAmount,
        },
      });
      return NextResponse.json({ ok: true, intent, paymentAccount: getUsdtPaymentAccount() });
    } catch (e: any) {
      if (e.code === "P2002" && attempt < 4) continue;
      return NextResponse.json({ ok: false, error: "No se pudo crear la solicitud" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, error: "No se pudo generar un código único" }, { status: 500 });
}

// Lista las solicitudes activas del cliente (para mostrarle si ya tiene
// alguna esperando pago o lista para comprar al entrar a la pantalla).
export async function GET() {
  const client = await requireClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const intents = await prisma.usdtPurchaseIntent.findMany({
    where: { clientId: client.id, status: { in: ["awaiting_payment", "ready_to_buy"] } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, intents, paymentAccount: getUsdtPaymentAccount() });
}
