import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { fetchCountryTradeRates } from "@/lib/rate-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

// Disparado cada 5 min por el cron de Vercel (ver vercel.json). Compara la
// tabla "tasa de compra venta" de la hoja publicada contra el último valor
// guardado por país en CountryRateHistory -- inserta una fila nueva SOLO si
// compra o venta cambiaron respecto a esa última fila, así la tabla queda
// como una línea de tiempo de cambios reales, no un snapshot repetido cada
// 5 minutos para países que no cambiaron.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const rates = await fetchCountryTradeRates();
  let inserted = 0;

  for (const r of rates) {
    const last = await prisma.countryRateHistory.findFirst({
      where: { country: r.country },
      orderBy: { recordedAt: "desc" },
    });

    const lastBuy = last?.buyRate != null ? Number(last.buyRate) : null;
    const lastSell = last?.sellRate != null ? Number(last.sellRate) : null;
    const changed = !last || lastBuy !== r.buy || lastSell !== r.sell;

    if (changed) {
      await prisma.countryRateHistory.create({
        data: { country: r.country, buyRate: r.buy, sellRate: r.sell },
      });
      inserted++;
    }
  }

  return NextResponse.json({ ok: true, checked: rates.length, inserted });
}
