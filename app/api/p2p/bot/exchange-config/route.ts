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

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const configs = await prisma.p2PBotExchangeConfig.findMany({
      where: { tenantId: session.tenantId },
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
        dailyVolumeCapUsdt: c.dailyVolumeCapUsdt ? Number(c.dailyVolumeCapUsdt) : null,
        circuitBreakPct: Number(c.circuitBreakPct),
        cycleInterval: Number(c.cycleInterval) || 30,
        minCompetitorCapital: c.minCompetitorCapital ? Number(c.minCompetitorCapital) : null,
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
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { exchange, ...data } = body;

    if (!exchange || !["binance", "bybit", "okx"].includes(exchange)) {
      return Response.json({ ok: false, error: "Exchange inválido" }, { status: 400 });
    }

    const update: any = {};
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.strategy !== undefined) update.strategy = data.strategy;
    if (data.top1Diff !== undefined) update.top1Diff = data.top1Diff;
    if (data.spreadPct !== undefined) update.spreadPct = data.spreadPct;
    if (data.priceFloorPct !== undefined) update.priceFloorPct = data.priceFloorPct;
    if (data.dailyVolumeCapUsdt !== undefined) update.dailyVolumeCapUsdt = data.dailyVolumeCapUsdt;
    if (data.circuitBreakPct !== undefined) update.circuitBreakPct = data.circuitBreakPct;
    if (data.cycleInterval !== undefined) update.cycleInterval = data.cycleInterval;
    if (data.minCompetitorCapital !== undefined) update.minCompetitorCapital = data.minCompetitorCapital;
    if (data.action === "start") {
      update.enabled = true;
      update.pauseUntil = null;
      update.lastStartedAt = new Date();
    }
    if (data.action === "stop") {
      update.enabled = false;
      update.lastStoppedAt = new Date();
    }

    const config = await prisma.p2PBotExchangeConfig.upsert({
      where: {
        tenantId_exchange: { tenantId: session.tenantId, exchange },
      },
      update,
      create: {
        tenantId: session.tenantId,
        exchange,
        enabled: data.enabled ?? data.action === "start" ? true : false,
        strategy: data.strategy ?? "top1",
        top1Diff: data.top1Diff ?? 0.1,
        spreadPct: data.spreadPct ?? 0.5,
        priceFloorPct: data.priceFloorPct ?? 0.2,
        circuitBreakPct: data.circuitBreakPct ?? 3,
        cycleInterval: data.cycleInterval ?? 30,
        minCompetitorCapital: data.minCompetitorCapital ?? null,
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
        cycleInterval: Number(config.cycleInterval) || 30,
        minCompetitorCapital: config.minCompetitorCapital ? Number(config.minCompetitorCapital) : null,
        pauseUntil: config.pauseUntil?.toISOString() || null,
        lastStartedAt: config.lastStartedAt?.toISOString() || null,
        lastStoppedAt: config.lastStoppedAt?.toISOString() || null,
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
