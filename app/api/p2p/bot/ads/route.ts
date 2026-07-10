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

async function getBybitClient(tenantId: number, label = "ONZE") {
  const creds = await prisma.bybitCredentials.findFirst({
    where: { tenantId, isActive: true, label },
    orderBy: { id: "asc" },
  });
  if (!creds) return null;
  return new BybitP2PClient(creds.apiKey, creds.secretKey);
}

async function getBinanceClient(tenantId: number, label?: string) {
  const creds = await getBinanceCredentials(tenantId, label);
  if (!creds) return null;
  return new BinanceP2PClient(creds.apiKey, creds.secretKey);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get("exchange");
    const label = searchParams.get("label") || "ONZE";

    // Fetch from local DB
    const where: any = { tenantId: session.tenantId, label };
    if (exchange) where.exchange = exchange;

    const ads = await prisma.p2PBotAd.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // If Binance, also try fetching live ads from Binance API
    let binanceAds: any[] = [];
    if (!exchange || exchange === "binance") {
      try {
        const client = await getBinanceClient(session.tenantId, label);
        if (client) {
          const res = await client.getMyAds(1, 50);
          const raw = Array.isArray(res?.data)
            ? res.data
            : res?.data?.items || res?.data?.list || res?.data?.records || res?.data?.result || res?.result || res?.list || [];
          // Sort ads so most recent comes first (defensive: handle duplicates)
          const sortedAds = [...ads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          binanceAds = raw.map((a: any) => {
            // Normalize advNo handling: Binance API returns advNo nested under `adv` sometimes
            const adv = a.adv || a;
            const binanceAdvNo = String(adv.advNo || adv.adNo || adv.id || a.advNo || a.id || a.advId);
            const localAd = sortedAds.find(la => la.adId === binanceAdvNo);
            const methods = (a.tradeMethods || []).map((pm: any) => pm.identifier || pm.paymentMethodId || pm.payType || String(pm));
            const rawLiveStatus = a.status ?? a.advStatus ?? a.adStatus;
            const liveStatus = rawLiveStatus === 1 || rawLiveStatus === 10 || rawLiveStatus === "ONLINE" || rawLiveStatus === "online" ? "online" : "offline";
            return {
              id: localAd?.id || a.advNo || a.id,
              adId: String(a.advNo || a.id || a.advId),
              exchange: "binance",
              tradeType: a.side === 0 ? "BUY" : "SELL",
              asset: a.tokenId || "USDT",
              fiat: a.currencyId || "CLP",
              priceType: a.priceType === 0 ? "fixed" : "float",
              price: Number(a.price) || 0,
              amount: Number(a.surplusAmount ?? a.tradableQuantity ?? a.lastQuantity ?? a.quantity ?? 0) || 0,
              minAmount: Number(a.minSingleTransAmount ?? a.minAmount) || 0,
              maxAmount: Number(a.maxSingleTransAmount ?? a.maxAmount) || 0,
              paymentMethods: methods,
              payTime: a.paymentPeriod || a.payTime || 15,
              status: localAd?.status || liveStatus,
              isActive: a.isOnline ?? true,
              botManaged: localAd?.botManaged || false,
              botEnabled: localAd?.botEnabled || false,
              botStrategy: localAd?.botStrategy || "top1",
              botTop1Diff: localAd?.botTop1Diff ? Number(localAd.botTop1Diff) : null,
              botSpreadPct: localAd?.botSpreadPct ? Number(localAd.botSpreadPct) : null,
              botPriceFloorPct: localAd?.botPriceFloorPct ? Number(localAd.botPriceFloorPct) : null,
              botPriceSource: localAd?.botPriceSource || "capacity",
              botCommissionPct: localAd?.botCommissionPct ? Number(localAd.botCommissionPct) : null,
              botSafeMarginPct: localAd?.botSafeMarginPct ? Number(localAd.botSafeMarginPct) : null,
              botMinCompetitorCapital: localAd?.botMinCompetitorCapital ? Number(localAd.botMinCompetitorCapital) : null,
              botCompetePayTypes: localAd?.botCompetePayTypes as string[] | null || null,
              botCycleInterval: localAd?.botCycleInterval ? Number(localAd.botCycleInterval) : null,
              botCircuitBreakPct: localAd?.botCircuitBreakPct ? Number(localAd.botCircuitBreakPct) : null,
              botDailyVolumeCapUsdt: localAd?.botDailyVolumeCapUsdt ? Number(localAd.botDailyVolumeCapUsdt) : null,
              createdAt: a.createDate || a.createdAt || new Date().toISOString(),
              fromBinance: true,
            };
          });
        }
      } catch (e) {
        // silent (geo-restricted from some locations)
      }
    }

    // If Bybit, also try fetching live ads from Bybit API
    let bybitAds: any[] = [];
    if (!exchange || exchange === "bybit") {
      try {
        const client = await getBybitClient(session.tenantId);
        if (client) {
          // Fetch payment method list to map type IDs to names
          const payNameMap: Record<string, string> = {};
          try {
            const payRes = await client.getPaymentMethods();
            const payList: any[] = payRes?.result || [];
            if (Array.isArray(payList)) {
              for (const pm of payList) {
                const typeId = String(pm.paymentConfigVo?.paymentType ?? pm.paymentType ?? '');
                const name = pm.paymentConfigVo?.paymentName || '';
                if (typeId && name) payNameMap[typeId] = name;
              }
            }
          } catch (_) {}
          const res = await client.getMyAds(1, 50);
          const items = res?.result?.items || [];
          bybitAds = items.map((a: any) => {
            const localAd = ads.find(la => la.adId === a.id);
            const rawPays: any[] = a.payments || [];
            const paymentMethods = rawPays.map((p: any) => {
              const typeId = String(p.paymentType ?? p);
              return { id: typeId, name: payNameMap[typeId] || typeId };
            });
            const bybitLiveStatus = String(a.status) === "10" ? "online" : "offline";
            return {
            id: localAd?.id || a.id,
            adId: a.id,
            exchange: "bybit",
            tradeType: a.side === 0 ? "BUY" : "SELL",
            asset: a.tokenId || "USDT",
            fiat: a.currencyId || "CLP",
            priceType: a.priceType === 0 ? "fixed" : "float",
            price: Number(a.price) || 0,
            amount: Number(a.surplusAmount ?? a.tradableQuantity ?? a.lastQuantity ?? a.quantity ?? 0) || 0,
            minAmount: Number(a.minSingleTransAmount ?? a.minAmount) || 0,
            maxAmount: Number(a.maxSingleTransAmount ?? a.maxAmount) || 0,
            paymentMethods,
            payTime: a.paymentPeriod || 15,
            status: localAd?.status || bybitLiveStatus,
            isActive: a.isOnline ?? true,
            botManaged: localAd?.botManaged || false,
            botEnabled: localAd?.botEnabled || false,
            botStrategy: localAd?.botStrategy || "top1",
            botTop1Diff: localAd?.botTop1Diff ? Number(localAd.botTop1Diff) : null,
            botSpreadPct: localAd?.botSpreadPct ? Number(localAd.botSpreadPct) : null,
            botPriceFloorPct: localAd?.botPriceFloorPct ? Number(localAd.botPriceFloorPct) : null,
            botPriceSource: localAd?.botPriceSource || "capacity",
            botCommissionPct: localAd?.botCommissionPct ? Number(localAd.botCommissionPct) : null,
            botSafeMarginPct: localAd?.botSafeMarginPct ? Number(localAd.botSafeMarginPct) : null,
            botMinCompetitorCapital: localAd?.botMinCompetitorCapital ? Number(localAd.botMinCompetitorCapital) : null,
            botCompetePayTypes: localAd?.botCompetePayTypes as string[] | null || null,
            botCycleInterval: localAd?.botCycleInterval ? Number(localAd.botCycleInterval) : null,
            botCircuitBreakPct: localAd?.botCircuitBreakPct ? Number(localAd.botCircuitBreakPct) : null,
            botDailyVolumeCapUsdt: localAd?.botDailyVolumeCapUsdt ? Number(localAd.botDailyVolumeCapUsdt) : null,
            createdAt: a.createDate ? new Date(Number(a.createDate)).toISOString() : new Date().toISOString(),
            fromBybit: true,
            };
          });
        }
      } catch (e) {
        // silent
      }
    }

    const merged = [...binanceAds, ...bybitAds, ...ads.map(a => ({
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
      botEnabled: a.botEnabled,
      botStrategy: a.botStrategy || "top1",
      botTop1Diff: a.botTop1Diff ? Number(a.botTop1Diff) : null,
      botSpreadPct: a.botSpreadPct ? Number(a.botSpreadPct) : null,
      botPriceFloorPct: a.botPriceFloorPct ? Number(a.botPriceFloorPct) : null,
      botPriceSource: a.botPriceSource || "capacity",
      botCommissionPct: a.botCommissionPct ? Number(a.botCommissionPct) : null,
      botSafeMarginPct: a.botSafeMarginPct ? Number(a.botSafeMarginPct) : null,
      botMinCompetitorCapital: a.botMinCompetitorCapital ? Number(a.botMinCompetitorCapital) : null,
      botCompetePayTypes: a.botCompetePayTypes as string[] | null || null,
      botCycleInterval: a.botCycleInterval ? Number(a.botCycleInterval) : null,
      botCircuitBreakPct: a.botCircuitBreakPct ? Number(a.botCircuitBreakPct) : null,
      botDailyVolumeCapUsdt: a.botDailyVolumeCapUsdt ? Number(a.botDailyVolumeCapUsdt) : null,
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
  return PUT(req);
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const label = body.label || req.nextUrl.searchParams.get("label") || "ONZE";
    const { id, adId, exchange, tradeType, asset, fiat, priceType, price, amount, minAmount, maxAmount, paymentMethods, payTime, status, isActive, botManaged, botEnabled, botTop1Diff, botSafeMarginPct, botCompetePayTypes, botPriceFloorPct, botPriceSource, botCommissionPct, botMinCompetitorCapital, botStrategy, botSpreadPct, botCycleInterval, botCircuitBreakPct, botDailyVolumeCapUsdt } = body;

    if (!exchange) {
      return Response.json({ ok: false, error: "exchange es requerido" }, { status: 400 });
    }

    // For Bybit: auto-delete old ad before creating new one
    if (exchange === "bybit") {
      try {
        const client = await getBybitClient(session.tenantId);
        if (client) {
          if (tradeType && id) {
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
          } else if (!id) {
            // Creating new ad: delete ALL existing Bybit ads first
            const existingAds = await prisma.p2PBotAd.findMany({
              where: { tenantId: session.tenantId, exchange: "bybit" },
            });
            for (const existing of existingAds) {
              try {
                if (existing.adId) await client.removeAd(existing.adId);
              } catch (_) {}
              await prisma.p2PBotAd.deleteMany({
                where: { id: existing.id, tenantId: session.tenantId },
              });
            }
          }
        }
      } catch (e: any) {
        return Response.json({ ok: false, error: `Bybit API error: ${e.message}` }, { status: 500 });
      }
    }

    // Resolve local DB record: by id, or by adId+exchange, or create new
    let dbRecord = null;
    const numericId = Number(id);
    let labelFix = false;
    // Only try findUnique by id if numericId is a safe positive integer (DB auto-increment IDs are small)
    if (!isNaN(numericId) && numericId > 0 && numericId < 2147483647) {
      const found = await prisma.p2PBotAd.findUnique({ where: { id: numericId } });
      if (found && found.tenantId === session.tenantId) dbRecord = found;
    }
    if (!dbRecord && adId) {
      let found = await prisma.p2PBotAd.findFirst({
        where: { tenantId: session.tenantId, exchange, adId: String(adId), label },
      });
      if (found) {
        dbRecord = found;
      } else {
        // Fallback: try without label filter (edge case where label was changed after ad creation)
        found = await prisma.p2PBotAd.findFirst({
          where: { tenantId: session.tenantId, exchange, adId: String(adId) },
        });
        if (found) {
          dbRecord = found;
          if (found.label !== label) labelFix = true;
        }
      }
    }
    // If id was given but not a DB id, try it as adId (only if it's a safe string length)
    if (!dbRecord && !adId && id && numericId < 2147483647) {
      const found = await prisma.p2PBotAd.findFirst({
        where: { tenantId: session.tenantId, exchange, adId: String(id) },
      });
      if (found) dbRecord = found;
    }

    const updateData: any = {};
    if (labelFix) updateData.label = label;
    if (tradeType !== undefined) updateData.tradeType = tradeType;
    if (asset !== undefined) updateData.asset = asset;
    if (fiat !== undefined) updateData.fiat = fiat;
    if (priceType !== undefined) updateData.priceType = priceType;
    if (price !== undefined) updateData.price = price;
    if (amount !== undefined) updateData.amount = amount;
    if (minAmount !== undefined) updateData.minAmount = minAmount;
    if (maxAmount !== undefined) updateData.maxAmount = maxAmount;
    if (paymentMethods !== undefined) updateData.paymentMethods = paymentMethods;
    if (payTime !== undefined) updateData.payTime = payTime;
    if (status !== undefined) updateData.status = status;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (botManaged !== undefined) updateData.botManaged = botManaged;
    if (botEnabled !== undefined) updateData.botEnabled = botEnabled;
    if (botStrategy !== undefined) updateData.botStrategy = botStrategy;
    if (botTop1Diff !== undefined) updateData.botTop1Diff = botTop1Diff;
    if (botSpreadPct !== undefined) updateData.botSpreadPct = botSpreadPct;
    if (botPriceFloorPct !== undefined) updateData.botPriceFloorPct = botPriceFloorPct;
    if (botPriceSource !== undefined) updateData.botPriceSource = botPriceSource;
    if (botCommissionPct !== undefined) updateData.botCommissionPct = botCommissionPct;
    if (botSafeMarginPct !== undefined) updateData.botSafeMarginPct = botSafeMarginPct;
    if (botMinCompetitorCapital !== undefined) updateData.botMinCompetitorCapital = botMinCompetitorCapital;
    if (botCompetePayTypes !== undefined) updateData.botCompetePayTypes = botCompetePayTypes;
    if (botCycleInterval !== undefined) updateData.botCycleInterval = botCycleInterval;
    if (botCircuitBreakPct !== undefined) updateData.botCircuitBreakPct = botCircuitBreakPct;
    if (botDailyVolumeCapUsdt !== undefined) updateData.botDailyVolumeCapUsdt = botDailyVolumeCapUsdt;
    if (body.label !== undefined) updateData.label = body.label;

    if (dbRecord) {
      updateData.updatedAt = new Date();
      const updated = await prisma.p2PBotAd.update({
        where: { id: dbRecord.id },
        data: updateData,
      });
      return Response.json({ ok: true, ad: updated });
    }

    // Create new
    const createData: any = {
      tenantId: session.tenantId,
      label,
      exchange,
      tradeType: tradeType || "SELL",
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
      updatedAt: new Date(),
      ...updateData,
    };
    if (adId) createData.adId = String(adId);
    else if (id && numericId > 0) createData.adId = String(id); // id from exchange adNo

    const created = await prisma.p2PBotAd.create({
      data: createData,
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
