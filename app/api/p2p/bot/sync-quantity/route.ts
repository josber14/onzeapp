import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient, getBinanceCredentials } from "@/lib/p2p-bot/binance-adapter";
import { BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { exchange, adId } = body;
    const label = body.label || req.nextUrl.searchParams.get("label") || "ONZE";
    if (!exchange || !adId) {
      return Response.json({ ok: false, error: "exchange y adId requeridos" });
    }

    if (exchange === "binance") {
      const creds = await getBinanceCredentials(session.tenantId, label);
      if (!creds) return Response.json({ ok: false, error: "Sin credenciales Binance" });
      const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);

      const balanceRes = await client.getBalance("USDT");
      const balance = Number(balanceRes?.balance ?? 0);
      if (balance <= 0) return Response.json({ ok: false, error: "Saldo USDT no disponible" });

      const detailRes = await client.getAdDetail(adId).catch(() => null);
      const adDetail = detailRes?.data?.adv || detailRes?.data || {};
      const currentPrice = Number(adDetail?.price ?? 0);

      await client.updateAdQuantity(adId, balance, currentPrice);

      return Response.json({ ok: true, quantity: balance });
    }

    if (exchange === "bybit") {
      const creds = await prisma.bybitCredentials.findFirst({
        where: { tenantId: session.tenantId, isActive: true, label },
        orderBy: { id: "asc" },
      });
      if (!creds) return Response.json({ ok: false, error: "Sin credenciales Bybit" });
      const client = new BybitP2PClient(creds.apiKey, creds.secretKey);

      const balanceRes = await client.getBalance("USDT");
      const usdtCoin = balanceRes?.result?.balance?.find((c: any) => c.coin === "USDT");
      const balance = usdtCoin ? Number(usdtCoin.walletBalance) : 0;
      if (balance <= 0) return Response.json({ ok: false, error: "Saldo USDT no disponible" });

      await client.updateAd({ id: adId, quantity: String(balance), actionType: "MODIFY" });

      return Response.json({ ok: true, quantity: balance });
    }

    return Response.json({ ok: false, error: "Exchange no soportado" });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
