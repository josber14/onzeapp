import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { SkipoClient } from "@/lib/skipo-adapter";
import { findMarginPct } from "@/lib/usdt-margin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solo cotiza — no ejecuta nada en Skipo ni reserva nada. El precio que ve
// el cliente ya incluye el margen del tramo que le corresponda por monto.
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (client.status !== "approved") {
    return NextResponse.json({ ok: false, error: "Tu cuenta no está aprobada todavía" }, { status: 403 });
  }

  // Throttle: máximo una cotización real a Skipo cada 1.5s por cliente
  // -- evita spam que agote el cupo de la API de Skipo. Claim atómico
  // (updateMany con condición) para que sea seguro entre procesos.
  const QUOTE_THROTTLE_MS = 1500;
  const cutoff = new Date(Date.now() - QUOTE_THROTTLE_MS);
  const claim = await prisma.usdtClient.updateMany({
    where: { id: client.id, OR: [{ lastQuoteAt: null }, { lastQuoteAt: { lt: cutoff } }] },
    data: { lastQuoteAt: new Date() },
  });
  if (claim.count === 0) {
    return NextResponse.json({ ok: false, error: "Espera un segundo antes de pedir otra cotización" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const clpAmountInput = body.clpAmount !== undefined ? Number(body.clpAmount) : undefined;
  const usdtAmountInput = body.usdtAmount !== undefined ? Number(body.usdtAmount) : undefined;
  if (clpAmountInput === undefined && usdtAmountInput === undefined) {
    return NextResponse.json({ ok: false, error: "Falta el monto" }, { status: 400 });
  }

  try {
    const skipoClient = new SkipoClient();
    let clpAmount: number;
    let usdtAmount: number;
    let marginPct: number;
    let clientRate: number;

    if (clpAmountInput !== undefined) {
      if (!(clpAmountInput >= 500)) {
        return NextResponse.json({ ok: false, error: "El monto mínimo es 500 CLP" }, { status: 400 });
      }
      if (client.purchaseLimitClp !== null && clpAmountInput > Number(client.purchaseLimitClp)) {
        return NextResponse.json({ ok: false, error: `Superas tu límite de compra (${Number(client.purchaseLimitClp).toLocaleString("es-CL")} CLP)` }, { status: 400 });
      }
      // Si el cliente tiene un % fijo asignado, manda sobre los tramos
      // generales — solo cae a los tramos por monto si quedó en blanco.
      marginPct = client.fixedMarginPct !== null
        ? Number(client.fixedMarginPct)
        : await findMarginPct(session.tenantId, clpAmountInput);
      const skipoQuote = await skipoClient.getQuotation({
        baseCurrencyId: "USDT",
        quoteCurrencyId: "CLP",
        qtyCurrencyId: "CLP",
        side: "BUY",
        quantity: String(clpAmountInput),
      });
      const skipoRate = Number(skipoQuote.rate);
      clientRate = skipoRate * (1 + marginPct / 100);
      clpAmount = clpAmountInput;
      usdtAmount = clpAmount / clientRate;
    } else {
      // Cliente escribió cuánto USDT quiere recibir -- se cotiza directo en
      // USDT (confirmado en vivo, ago 2026: qtyCurrencyId="USDT" es válido y
      // Skipo devuelve quoteQty = CLP equivalente SIN margen). Ese CLP sin
      // margen se usa para elegir el tramo correcto (el margen depende del
      // monto en CLP, no del monto en USDT), y recién ahí se calcula el CLP
      // final que el cliente debe transferir.
      if (!(usdtAmountInput! > 0)) {
        return NextResponse.json({ ok: false, error: "Ingresa una cantidad de USDT válida" }, { status: 400 });
      }
      const skipoQuote = await skipoClient.getQuotation({
        baseCurrencyId: "USDT",
        quoteCurrencyId: "CLP",
        qtyCurrencyId: "USDT",
        side: "BUY",
        quantity: String(usdtAmountInput),
      });
      const skipoRate = Number(skipoQuote.rate);
      const estimatedClp = Number(skipoQuote.quoteQty);
      marginPct = client.fixedMarginPct !== null
        ? Number(client.fixedMarginPct)
        : await findMarginPct(session.tenantId, estimatedClp);
      clientRate = skipoRate * (1 + marginPct / 100);
      usdtAmount = usdtAmountInput!;
      clpAmount = usdtAmount * clientRate;

      if (!(clpAmount >= 500)) {
        return NextResponse.json({ ok: false, error: "El monto mínimo es 500 CLP" }, { status: 400 });
      }
      if (client.purchaseLimitClp !== null && clpAmount > Number(client.purchaseLimitClp)) {
        return NextResponse.json({ ok: false, error: `Superas tu límite de compra (${Number(client.purchaseLimitClp).toLocaleString("es-CL")} CLP)` }, { status: 400 });
      }
    }

    // No bloquea la respuesta al cliente — es solo para el historial visual
    // de los últimos minutos, no una fuente de verdad para ejecutar compras.
    prisma.usdtPriceTick.create({ data: { tenantId: session.tenantId, rate: clientRate } }).catch(() => {});

    return NextResponse.json({
      ok: true,
      quote: {
        clpAmount,
        rate: clientRate,
        usdtAmount,
        marginPct,
        expiresInSeconds: 5,
      },
    });
  } catch (e: any) {
    // Nunca reenviar e.message al cliente: el adaptador del proveedor lo
    // arma con el nombre del proveedor y su propio dominio adentro (ver
    // lib/skipo-adapter.ts) -- pedido explícito del usuario, ningún cliente
    // debe poder ver quién es el proveedor real detrás de la compra.
    console.error(`[usdt-client/quote] ${e.message}`);
    return NextResponse.json({ ok: false, error: "No se pudo cotizar en este momento, intenta de nuevo en unos segundos" }, { status: 502 });
  }
}
