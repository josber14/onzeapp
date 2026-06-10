import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get("exchange") || "bybit";

    if (exchange === "bybit") {
      const creds = await prisma.bybitCredentials.findUnique({
        where: { tenantId: session.tenantId, isActive: true },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Bybit" });
      }

      try {
        const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
        const res = await client.getBalance("USDT");
        const balance = res?.result?.balance ? Number(res.result.balance) : 0;
        const available = res?.result?.availableBalance ? Number(res.result.availableBalance) : balance;
        return Response.json({
          ok: true,
          exchange: "bybit",
          asset: "USDT",
          balance,
          available,
          message: null,
        });
      } catch (e: any) {
        return Response.json({ ok: false, error: e.message });
      }
    }

    if (exchange === "binance") {
      const creds = await prisma.binanceCredentials.findUnique({
        where: { tenantId: session.tenantId, isActive: true },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Binance" });
      }
      try {
        const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
        const res = await client.getBalance("USDT");
        const balance = Number(res.balance) || 0;
        const available = Number(res.free) || 0;
        return Response.json({
          ok: true,
          exchange: "binance",
          asset: "USDT",
          balance,
          available,
          message: null,
        });
      } catch (e: any) {
        return Response.json({ ok: false, error: e.message });
      }
    }

    if (exchange === "okx") {
      return Response.json({ ok: false, error: "Lectura de saldo OKX no implementada" });
    }

    return Response.json({ ok: false, error: "Exchange no soportado" });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
