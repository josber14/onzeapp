import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { SkipoClient } from "@/lib/skipo-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findMarginPct(tenantId: number, clpAmount: number): Promise<number> {
  const tiers = await prisma.usdtMarginTier.findMany({ where: { tenantId }, orderBy: { minClp: "asc" } });
  for (const t of tiers) {
    const min = Number(t.minClp);
    const max = t.maxClp !== null ? Number(t.maxClp) : Infinity;
    if (clpAmount >= min && clpAmount <= max) return Number(t.marginPct);
  }
  // Sin tramo configurado que calce — margen de seguridad por defecto en vez
  // de vender al precio crudo de Skipo (nunca vender sin margen).
  return 3;
}

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

  const body = await req.json().catch(() => ({}));
  const clpAmount = Number(body.clpAmount);
  if (!(clpAmount >= 500)) {
    return NextResponse.json({ ok: false, error: "El monto mínimo es 500 CLP" }, { status: 400 });
  }
  if (client.purchaseLimitClp !== null && clpAmount > Number(client.purchaseLimitClp)) {
    return NextResponse.json({ ok: false, error: `Superas tu límite de compra (${Number(client.purchaseLimitClp).toLocaleString("es-CL")} CLP)` }, { status: 400 });
  }

  try {
    // Si el cliente tiene un % fijo asignado, manda sobre los tramos
    // generales — solo cae a los tramos por monto si quedó en blanco.
    const marginPct = client.fixedMarginPct !== null
      ? Number(client.fixedMarginPct)
      : await findMarginPct(session.tenantId, clpAmount);
    const skipoClient = new SkipoClient();
    const skipoQuote = await skipoClient.getQuotation({
      baseCurrencyId: "USDT",
      quoteCurrencyId: "CLP",
      qtyCurrencyId: "CLP",
      side: "BUY",
      quantity: String(clpAmount),
    });

    const skipoRate = Number(skipoQuote.rate);
    const clientRate = skipoRate * (1 + marginPct / 100);
    const usdtAmount = clpAmount / clientRate;

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
    return NextResponse.json({ ok: false, error: e.message || "No se pudo cotizar" }, { status: 502 });
  }
}
