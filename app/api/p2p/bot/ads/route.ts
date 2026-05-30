import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

async function getBybitClient(tenantId: number) {
  const creds = await prisma.bybitCredentials.findUnique({
    where: { tenantId, isActive: true },
  });
  if (!creds) return null;
  return new BybitP2PClient(creds.apiKey, creds.secretKey);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get("exchange");

    // Fetch from local DB
    const where: any = { tenantId: session.tenantId };
    if (exchange) where.exchange = exchange;

    const ads = await prisma.p2PBotAd.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // If Bybit, also try fetching live ads from Bybit API
    let bybitAds: any[] = [];
    if (!exchange || exchange === "bybit") {
      try {
        const client = await getBybitClient(session.tenantId);
        if (client) {
          const res = await client.getMyAds(1, 50);
          const items = res?.result?.items || [];
          bybitAds = items.map((a: any) => {
            const localAd = ads.find(la => la.adId === a.id);
            return {
            id: localAd?.id || a.id,
            adId: a.id,
            exchange: "bybit",
            tradeType: a.side === 0 ? "BUY" : "SELL",
            asset: a.tokenId || "USDT",
            fiat: a.currencyId || "CLP",
            priceType: a.priceType === 0 ? "fixed" : "float",
            price: Number(a.price) || 0,
            amount: Number(a.lastQuantity) || 0,
            minAmount: Number(a.minAmount) || 0,
            maxAmount: Number(a.maxAmount) || 0,
            paymentMethods: a.payments || [],
            payTime: a.paymentPeriod || 15,
            status: a.status === 10 ? "online" : "offline",
            isActive: a.isOnline,
            botManaged: localAd?.botManaged || false,
            createdAt: a.createDate ? new Date(Number(a.createDate)).toISOString() : new Date().toISOString(),
            fromBybit: true,
            };
          });
        }
      } catch (e) {
        // silent
      }
    }

    const merged = [...bybitAds, ...ads.map(a => ({
      id: a.id,
      exchange: a.exchange,
      adId: a.adId,
      tradeType: a.tradeType,
      asset: a.asset,
      fiat: a.fiat,
      priceType: a.priceType,
      price: Number(a.price),
      amount: Number(a.amount),
      amountType: a.amountType,
      minAmount: Number(a.minAmount),
      maxAmount: Number(a.maxAmount),
      paymentMethods: a.paymentMethods,
      payTime: a.payTime,
      status: a.status,
      isActive: a.isActive,
      botManaged: a.botManaged,
      createdAt: a.createdAt.toISOString(),
      fromBybit: false,
    }))];

    const seen = new Set<string>();
    const deduped = merged.filter(a => {
      const key = `${a.exchange}-${a.adId || a.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return Response.json({ ok: true, ads: deduped });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { id, exchange, tradeType, asset, fiat, priceType, price, amount, minAmount, maxAmount, paymentMethods, payTime, status, isActive, botManaged } = body;

    if (!exchange || !tradeType) {
      return Response.json({ ok: false, error: "exchange y tradeType son requeridos" }, { status: 400 });
    }

    // For Bybit, also post to Bybit API
    if (exchange === "bybit") {
      try {
        const client = await getBybitClient(session.tenantId);
        if (client) {
          if (id) {
            // Update existing ad on Bybit
            const updateParams: any = { id: String(id) };
            if (price !== undefined) updateParams.price = String(price);
            if (amount !== undefined) updateParams.quantity = String(amount);
            if (minAmount !== undefined) updateParams.minAmount = String(minAmount);
            if (maxAmount !== undefined) updateParams.maxAmount = String(maxAmount);
            if (paymentMethods) updateParams.payments = paymentMethods;
            if (payTime) updateParams.paymentPeriod = payTime;
            if (status) updateParams.status = status === "online" ? 10 : 20;
            await client.updateAd(updateParams);
          } else {
            // Create new ad on Bybit
            await client.postAd({
              tokenId: asset || "USDT",
              currencyId: fiat || "CLP",
              side: tradeType === "BUY" ? "0" : "1",
              price: String(price || 0),
              quantity: String(amount || 0),
              minAmount: String(minAmount || 0),
              maxAmount: String(maxAmount || 0),
              payments: paymentMethods || [],
              paymentPeriod: payTime || 15,
            });
          }
        }
      } catch (e: any) {
        return Response.json({ ok: false, error: `Bybit API error: ${e.message}` }, { status: 500 });
      }
    }

    // Save to local DB
    if (id) {
      const existing = await prisma.p2PBotAd.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== session.tenantId) {
        return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
      }
      const updated = await prisma.p2PBotAd.update({
        where: { id },
        data: {
          tradeType,
          asset: asset || "USDT",
          fiat: fiat || "CLP",
          priceType: priceType || "fixed",
          price: price || 0,
          amount: amount || 0,
          minAmount: minAmount || 0,
          maxAmount: maxAmount || 0,
          paymentMethods: paymentMethods || [],
          payTime: payTime || 15,
          status: status || "online",
          isActive: isActive !== undefined ? isActive : true,
          botManaged: botManaged !== undefined ? botManaged : false,
          updatedAt: new Date(),
        },
      });
      return Response.json({ ok: true, ad: updated });
    }

    const created = await prisma.p2PBotAd.create({
      data: {
        tenantId: session.tenantId,
        exchange,
        tradeType,
        asset: asset || "USDT",
        fiat: fiat || "CLP",
        priceType: priceType || "fixed",
        price: price || 0,
        amount: amount || 0,
        minAmount: minAmount || 0,
        maxAmount: maxAmount || 0,
        paymentMethods: paymentMethods || [],
        payTime: payTime || 15,
        status: status || "online",
        isActive: isActive !== undefined ? isActive : true,
        botManaged: botManaged !== undefined ? botManaged : false,
        updatedAt: new Date(),
      },
    });

    return Response.json({ ok: true, ad: created });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    const adId = searchParams.get("adId");
    const exchange = searchParams.get("exchange");

    if (!id) {
      return Response.json({ ok: false, error: "id requerido" }, { status: 400 });
    }

    // Also remove from Bybit if it's a Bybit ad
    if (adId && exchange === "bybit") {
      try {
        const client = await getBybitClient(session.tenantId);
        if (client) {
          await client.removeAd(adId);
        }
      } catch (e) {
        // silent
      }
    }

    await prisma.p2PBotAd.deleteMany({
      where: { id, tenantId: session.tenantId },
    });

    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
