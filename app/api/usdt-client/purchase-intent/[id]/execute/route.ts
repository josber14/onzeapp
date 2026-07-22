import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { SkipoClient } from "@/lib/skipo-adapter";
import { findMarginPct } from "@/lib/usdt-margin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ejecuta la compra real — SOLO si el intent ya está en ready_to_buy (el
// pago fue confirmado). Pide una cotización FRESCA a Skipo en este mismo
// momento (nunca reutiliza un precio viejo) y la ejecuta sobre el monto
// REAL recibido (receivedClp), no el que el cliente pidió originalmente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (client.status !== "approved") {
    return NextResponse.json({ ok: false, error: "Tu cuenta no está aprobada todavía" }, { status: 403 });
  }

  const { id } = await params;
  const intent = await prisma.usdtPurchaseIntent.findUnique({ where: { id: Number(id) } });
  if (!intent || intent.clientId !== client.id || intent.tenantId !== client.tenantId) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }
  if (intent.status !== "ready_to_buy") {
    return NextResponse.json({ ok: false, error: "Todavía no confirmamos tu pago" }, { status: 400 });
  }

  // Reclama el intent atómicamente antes de tocar Skipo — evita ejecutar la
  // compra 2 veces si el cliente hace doble click o el request se reintenta
  // (la plata solo llegó una vez, nunca se puede comprar dos veces con ella).
  const claim = await prisma.usdtPurchaseIntent.updateMany({
    where: { id: intent.id, status: "ready_to_buy" },
    data: { status: "executing" },
  });
  if (claim.count === 0) {
    return NextResponse.json({ ok: false, error: "Esta compra ya se está procesando o ya se completó" }, { status: 409 });
  }

  const receivedClp = Number(intent.receivedClp);
  const skipoClient = new SkipoClient();

  // Cotización + confirmación en Skipo: si CUALQUIERA de estas dos falla, no
  // se movió plata todavía (o Skipo la rechazó), así que es seguro liberar
  // el intent de vuelta a ready_to_buy para que el cliente reintente.
  let skipoOrdId: string;
  let clientRate: number;
  let usdtAmount: number;
  let skipoConvertId: string;
  try {
    const marginPct = client.fixedMarginPct !== null
      ? Number(client.fixedMarginPct)
      : await findMarginPct(client.tenantId, receivedClp);

    const skipoQuote = await skipoClient.getQuotation({
      baseCurrencyId: "USDT",
      quoteCurrencyId: "CLP",
      qtyCurrencyId: "CLP",
      side: "BUY",
      quantity: String(receivedClp),
    });
    const skipoRate = Number(skipoQuote.rate);
    clientRate = skipoRate * (1 + marginPct / 100);
    usdtAmount = receivedClp / clientRate;
    skipoOrdId = skipoQuote.ordId;

    const result = await skipoClient.confirmQuotation(skipoOrdId);
    skipoConvertId = result.buyConvertId || result.transactionId;
  } catch (e: any) {
    await prisma.usdtPurchaseIntent.update({ where: { id: intent.id }, data: { status: "ready_to_buy" } }).catch(() => {});
    return NextResponse.json({ ok: false, error: e.message || "No se pudo ejecutar la compra" }, { status: 502 });
  }

  // A partir de acá la compra YA se ejecutó en Skipo (dinero real ya se
  // movió) — si esta escritura falla, NUNCA se debe reintentar la compra ni
  // volver a "ready_to_buy" (eso compraría dos veces con la misma plata). El
  // intent queda en "executing", visible para que el operador lo resuelva a
  // mano con los datos de Skipo ya guardados en el log/mensaje de error.
  try {
    const updated = await prisma.usdtPurchaseIntent.update({
      where: { id: intent.id },
      data: {
        status: "completed",
        usdtAmount,
        executedRate: clientRate,
        skipoOrdId,
        skipoConvertId,
        executedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, intent: updated });
  } catch (e: any) {
    console.error(`[UsdtPurchaseIntent ${intent.id}] compra ejecutada en Skipo (ordId=${skipoOrdId}) pero falló guardar el resultado: ${e.message}`);
    return NextResponse.json({ ok: false, error: "Tu compra se procesó pero hubo un error al registrarla — contáctanos con este código: " + skipoOrdId }, { status: 500 });
  }
}
