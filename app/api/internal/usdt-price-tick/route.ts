import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SkipoClient } from "@/lib/skipo-adapter";
import { findMarginPct } from "@/lib/usdt-margin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Único tenant real hoy (mismo criterio ya usado en todo lib/p2p-bot/* y en
// los scripts de mantenimiento — ver AGENTS.md).
const TENANT_ID = 1;

// Monto de referencia solo para tomar la muestra de precio — cae en el tramo
// de margen de 100.000-199.999 CLP. No representa ninguna compra real.
const REFERENCE_CLP = 100_000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Llamado por un cron externo (cron-job.org, mismo patrón que
// usdt-payment-poll) cada pocos minutos. Sin esto, el historial de precio
// que ve el cliente solo se llenaba cuando alguien cotizaba activamente en
// la pantalla de Comprar — por eso salía vacío casi siempre.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const marginPct = await findMarginPct(TENANT_ID, REFERENCE_CLP);
    const skipoClient = new SkipoClient();
    const skipoQuote = await skipoClient.getQuotation({
      baseCurrencyId: "USDT",
      quoteCurrencyId: "CLP",
      qtyCurrencyId: "CLP",
      side: "BUY",
      quantity: String(REFERENCE_CLP),
    });

    const rate = Number(skipoQuote.rate) * (1 + marginPct / 100);
    await prisma.usdtPriceTick.create({ data: { tenantId: TENANT_ID, rate } });

    return NextResponse.json({ ok: true, rate });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo tomar el precio" }, { status: 502 });
  }
}
