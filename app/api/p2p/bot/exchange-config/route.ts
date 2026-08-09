import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
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

    const label = req.nextUrl.searchParams.get("label") || "ONZE";

    // Bybit y OKX no tienen concepto de ONZE/ZINPLE -- siempre usan label
    // fijo "ONZE" (ver engine.ts). Si solo filtráramos por el label pedido
    // (ej. "ZINPLE" al mirar la pestaña Binance con esa cuenta), su estado
    // desaparecería del agregado "_allExchanges"/"_runningLabel" del panel,
    // mostrando "Detenido" aunque Bybit/OKX sigan corriendo de verdad.
    const configs = await prisma.p2PBotExchangeConfig.findMany({
      where: {
        tenantId: session.tenantId,
        OR: [
          { exchange: "binance", label },
          { exchange: { in: ["bybit", "okx"] }, label: "ONZE" },
        ],
      },
    });

    const result: Record<string, any> = {};
    for (const c of configs) {
      result[c.exchange] = {
        id: c.id,
        enabled: c.enabled,
        strategy: c.strategy,
        top1Diff: Number(c.top1Diff),
        spreadPct: Number(c.spreadPct),
        priceFloorPct: Number(c.priceFloorPct),
        priceSource: c.priceSource || "capacity",
        dailyVolumeCapUsdt: c.dailyVolumeCapUsdt ? Number(c.dailyVolumeCapUsdt) : null,
        circuitBreakPct: Number(c.circuitBreakPct),
        cycleInterval: c.cycleInterval ?? 10,
        minCompetitorCapital: c.minCompetitorCapital ? Number(c.minCompetitorCapital) : null,
        competePayTypes: c.competePayTypes as string[] | null,
        chatBotEnabled: c.chatBotEnabled ?? false,
        chatCookies: c.chatCookies as string | null,
        commissionPct: Number(c.commissionPct) || 0.14,
        safeMarginPct: Number(c.safeMarginPct) || 0,
        minAdPriceDiffPct: c.minAdPriceDiffPct != null ? Number(c.minAdPriceDiffPct) : 0.1,
        pauseUntil: c.pauseUntil?.toISOString() || null,
        lastStartedAt: c.lastStartedAt?.toISOString() || null,
        lastStoppedAt: c.lastStoppedAt?.toISOString() || null,
      };
    }

    return Response.json({ ok: true, configs: result });
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
    const { exchange, ...data } = body;
    const label = data.label || "ONZE";

    if (!exchange || !["binance", "bybit", "okx"].includes(exchange)) {
      return Response.json({ ok: false, error: "Exchange inválido" }, { status: 400 });
    }

    const update: any = {};
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.strategy !== undefined) update.strategy = data.strategy;
    if (data.top1Diff !== undefined) update.top1Diff = data.top1Diff;
    if (data.spreadPct !== undefined) update.spreadPct = data.spreadPct;
    if (data.priceFloorPct !== undefined) update.priceFloorPct = data.priceFloorPct;
    if (data.priceSource !== undefined) update.priceSource = data.priceSource;
    if (data.dailyVolumeCapUsdt !== undefined) update.dailyVolumeCapUsdt = data.dailyVolumeCapUsdt;
    if (data.circuitBreakPct !== undefined) update.circuitBreakPct = data.circuitBreakPct;
    if (data.cycleInterval !== undefined) update.cycleInterval = data.cycleInterval;
    if (data.minCompetitorCapital !== undefined) update.minCompetitorCapital = data.minCompetitorCapital;
    if (data.competePayTypes !== undefined) update.competePayTypes = data.competePayTypes;
    if (data.chatBotEnabled !== undefined) update.chatBotEnabled = data.chatBotEnabled;
    if (data.chatCookies !== undefined) update.chatCookies = data.chatCookies;
    if (data.commissionPct !== undefined) update.commissionPct = data.commissionPct;
    if (data.safeMarginPct !== undefined) update.safeMarginPct = data.safeMarginPct;
    if (data.minAdPriceDiffPct !== undefined) update.minAdPriceDiffPct = data.minAdPriceDiffPct;
    if (data.action === "start") {
      update.enabled = true;
      update.pauseUntil = null;
      update.lastStartedAt = new Date();
      // P2PBotConfig.exchanges es de TODO el tenant, no de una cuenta puntual
      // -- NO se filtra por label acá. Bug real confirmado en vivo (ago
      // 2026): filtrar por label hacía que iniciar un exchange bajo una
      // cuenta (ej. Bybit, que siempre usa "ONZE") sobreescribiera esta
      // lista con SOLO lo que está prendido bajo ESE label, borrando de la
      // lista cualquier exchange que solo estuviera prendido bajo OTRA
      // cuenta (ej. Binance bajo "ZINPLE") -- el servidor dejaba de ciclar
      // ese exchange por completo, aunque su propia fila siguiera diciendo
      // "activo". Por eso cambiar de pestaña Binance/Bybit "apagaba" al otro.
      const allEnabledExchanges = await prisma.p2PBotExchangeConfig.findMany({
        where: { tenantId: session.tenantId, enabled: true },
        select: { exchange: true },
        distinct: ["exchange"],
      });
      let enabledList = allEnabledExchanges.map(e => e.exchange);
      if (!enabledList.includes(exchange)) enabledList.push(exchange);
      await prisma.p2PBotConfig.upsert({
        where: { tenantId: session.tenantId },
        update: { enabled: true, pauseUntil: null, exchanges: enabledList },
        create: { tenantId: session.tenantId, enabled: true, exchanges: [exchange] },
      });
    }
    if (data.action === "stop") {
      update.enabled = false;
      update.lastStoppedAt = new Date();
    }

    const config = await prisma.p2PBotExchangeConfig.upsert({
      where: {
        tenantId_exchange_label: { tenantId: session.tenantId, exchange, label },
      },
      update,
      create: {
        tenantId: session.tenantId,
        label,
        exchange,
        enabled: data.enabled ?? data.action === "start" ? true : false,
        strategy: data.strategy ?? "top1",
        top1Diff: data.top1Diff ?? 0.1,
        spreadPct: data.spreadPct ?? 0.5,
        priceFloorPct: data.priceFloorPct ?? 0,
        priceSource: data.priceSource ?? "capacity",
        circuitBreakPct: data.circuitBreakPct ?? 3,
        cycleInterval: data.cycleInterval ?? 30,
        minCompetitorCapital: data.minCompetitorCapital ?? null,
        competePayTypes: (data.competePayTypes ?? null) as any,
        commissionPct: data.commissionPct ?? 0.14,
        safeMarginPct: data.safeMarginPct ?? 0,
        minAdPriceDiffPct: data.minAdPriceDiffPct ?? 0.1,
        chatBotEnabled: data.chatBotEnabled ?? false,
      },
    });

    return Response.json({
      ok: true,
      config: {
        id: config.id,
        enabled: config.enabled,
        strategy: config.strategy,
        top1Diff: Number(config.top1Diff),
        spreadPct: Number(config.spreadPct),
        priceFloorPct: Number(config.priceFloorPct),
        dailyVolumeCapUsdt: config.dailyVolumeCapUsdt ? Number(config.dailyVolumeCapUsdt) : null,
        circuitBreakPct: Number(config.circuitBreakPct),
        cycleInterval: config.cycleInterval ?? 10,
        minCompetitorCapital: config.minCompetitorCapital ? Number(config.minCompetitorCapital) : null,
        competePayTypes: config.competePayTypes as string[] | null,
        chatBotEnabled: config.chatBotEnabled ?? false,
        chatCookies: config.chatCookies as string | null,
        commissionPct: Number(config.commissionPct) || 0.14,
        safeMarginPct: Number(config.safeMarginPct) || 0,
        minAdPriceDiffPct: config.minAdPriceDiffPct != null ? Number(config.minAdPriceDiffPct) : 0.1,
        pauseUntil: config.pauseUntil?.toISOString() || null,
        lastStartedAt: config.lastStartedAt?.toISOString() || null,
        lastStoppedAt: config.lastStoppedAt?.toISOString() || null,
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
