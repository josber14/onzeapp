import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { fetchLiveMarket } from "@/lib/p2p-bot/live";

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
    const type = searchParams.get("type") || "latest";
    const exchange = (searchParams.get("exchange") || "bybit") as "binance" | "bybit" | "okx";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const live = searchParams.get("live") === "true";

    if (live && type === "latest") {
      try {
        const market = await fetchLiveMarket(exchange, session.tenantId);
        return Response.json({
          ok: true,
          data: {
            cycleAt: market.cycleAt,
            targetPrice: market.targetPrice,
            ourAd: market.ourAd,
            totalCompetitors: market.totalCompetitors,
            ranked: market.competitors.slice(0, limit),
          },
        });
      } catch (e: any) {
        return Response.json({ ok: false, error: e.message }, { status: 400 });
      }
    }

    if (type === "history") {
      const snapshots = await prisma.p2PBotMarketSnapshot.findMany({
        where: { tenantId: session.tenantId, exchange, side: "1" },
        orderBy: { cycleAt: "asc" },
        take: limit,
      });
      const chartData = snapshots.map((s) => {
        const comps = (s.competitors as any[]) || [];
        const prices = comps.map((c: any) => Number(c.price)).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
        const top3 = prices.slice(0, 3);
        const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : null;
        const totalVolume = comps.reduce((sum: number, c: any) => sum + Number(c.lastQuantity ?? c.quantity ?? 0), 0);
        return {
          cycleAt: s.cycleAt.toISOString(),
          targetPrice: s.targetPrice ? Number(s.targetPrice) : null,
          ourPrice: s.ourAd ? (s.ourAd as any).price : null,
          top1Price: top3[0] ?? null,
          top2Price: top3[1] ?? null,
          top3Price: top3[2] ?? null,
          competitorCount: comps.length,
          avgPrice,
          minPrice: prices[0] ?? null,
          maxPrice: prices[prices.length - 1] ?? null,
          totalVolume,
        };
      });
      return Response.json({ ok: true, data: chartData });
    }

    if (type === "stats") {
      const totalOrders = await prisma.p2PBotOrder.count({
        where: { tenantId: session.tenantId, exchange },
      });
      const completedOrders = await prisma.p2PBotOrder.count({
        where: { tenantId: session.tenantId, exchange, status: "completed" },
      });
      const pendingOrders = await prisma.p2PBotOrder.count({
        where: { tenantId: session.tenantId, exchange, status: { notIn: ["completed", "cancelled"] } },
      });
      const totalVolume = await prisma.p2PBotOrder.aggregate({
        where: { tenantId: session.tenantId, exchange, status: "completed" },
        _sum: { totalPrice: true },
      });
      const avgPrice = await prisma.p2PBotOrder.aggregate({
        where: { tenantId: session.tenantId, exchange, status: "completed" },
        _avg: { unitPrice: true },
      });
      const totalSnapshots = await prisma.p2PBotMarketSnapshot.count({
        where: { tenantId: session.tenantId, exchange },
      });
      return Response.json({
        ok: true,
        data: {
          totalOrders,
          completedOrders,
          pendingOrders,
          cancelledOrders: totalOrders - completedOrders - pendingOrders,
          totalVolumeUsdt: totalVolume._sum.totalPrice ? Number(totalVolume._sum.totalPrice) : 0,
          avgUnitPrice: avgPrice._avg.unitPrice ? Number(avgPrice._avg.unitPrice) : 0,
          totalSnapshots,
        },
      });
    }

    if (type === "merchants") {
      const recentSnapshots = await prisma.p2PBotMarketSnapshot.findMany({
        where: { tenantId: session.tenantId, exchange, side: "1" },
        orderBy: { cycleAt: "desc" },
        take: 20,
      });
      if (!recentSnapshots.length) {
        return Response.json({ ok: true, data: [] });
      }
      const merchantMap = new Map<string, {
        nickName: string;
        appearances: number;
        totalPrice: number;
        totalMin: number;
        totalMax: number;
        totalAvailable: number;
        totalOrders: number;
        totalCompletion: number;
        banks: Set<string>;
        lastSeen: string;
        bestRank: number;
        ranks: number[];
      }>();
      for (const snap of recentSnapshots) {
        const comps = (snap.competitors as any[]) || [];
        for (const c of comps) {
          const key = c.nickName || c.id;
          if (!key) continue;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, {
              nickName: c.nickName || "Anon",
              appearances: 0,
              totalPrice: 0,
              totalMin: 0,
              totalMax: 0,
              totalAvailable: 0,
              totalOrders: 0,
              totalCompletion: 0,
              banks: new Set(),
              lastSeen: snap.cycleAt.toISOString(),
              bestRank: Infinity,
              ranks: [],
            });
          }
          const m = merchantMap.get(key)!;
          m.appearances++;
          m.totalPrice += Number(c.price ?? 0);
          m.totalMin += Number(c.minAmount ?? 0);
          m.totalMax += Number(c.maxAmount ?? 0);
          m.totalAvailable += Number(c.lastQuantity ?? c.quantity ?? 0);
          m.totalOrders += Number(c.orderCount ?? 0);
          m.totalCompletion += Number(c.completionRate ?? 0);
          const banks = c.paymentMethods || [];
          for (const pm of banks) {
            if (pm.name) m.banks.add(pm.name);
          }
          if (snap.cycleAt.toISOString() > m.lastSeen) {
            m.lastSeen = snap.cycleAt.toISOString();
          }
          const rank = (comps as any[]).indexOf(c) + 1;
          if (rank > 0 && rank < m.bestRank) m.bestRank = rank;
          m.ranks.push(rank);
        }
      }
      const topMerchants = Array.from(merchantMap.values())
        .sort((a, b) => b.appearances - a.appearances)
        .slice(0, 10)
        .map((m) => ({
          nickName: m.nickName,
          appearances: m.appearances,
          avgPrice: m.totalPrice / m.appearances,
          avgMin: m.totalMin / m.appearances,
          avgMax: m.totalMax / m.appearances,
          avgAvailable: m.totalAvailable / m.appearances,
          avgOrdersPerCycle: m.totalOrders / m.appearances,
          avgCompletionRate: m.totalCompletion / m.appearances,
          banks: Array.from(m.banks),
          bankCount: m.banks.size,
          lastSeen: m.lastSeen,
          bestRank: m.bestRank,
          avgRank: m.ranks.reduce((a, b) => a + b, 0) / m.ranks.length,
        }));
      return Response.json({ ok: true, data: topMerchants });
    }

    if (type === "banks") {
      const latest = await prisma.p2PBotMarketSnapshot.findFirst({
        where: { tenantId: session.tenantId, exchange, side: "1" },
        orderBy: { cycleAt: "desc" },
      });
      if (!latest) {
        return Response.json({ ok: true, data: [] });
      }
      const competitors = (latest.competitors as any[]) || [];
      const bankCount = new Map<string, { count: number; totalAvailable: number }>();
      let totalCompetitorsWithBanks = 0;
      for (const c of competitors) {
        const banks = c.paymentMethods || [];
        const seen = new Set<string>();
        for (const pm of banks) {
          if (!pm.name || seen.has(pm.name)) continue;
          seen.add(pm.name);
          const existing = bankCount.get(pm.name) || { count: 0, totalAvailable: 0 };
          existing.count++;
          existing.totalAvailable += Number(c.lastQuantity ?? c.quantity ?? 0);
          bankCount.set(pm.name, existing);
        }
        if (seen.size > 0) totalCompetitorsWithBanks++;
      }
      const bankStats = Array.from(bankCount.entries())
        .map(([name, stats]) => ({
          name,
          merchantCount: stats.count,
          pct: totalCompetitorsWithBanks > 0
            ? Math.round((stats.count / totalCompetitorsWithBanks) * 100)
            : 0,
          totalAvailableUsdt: Math.round(stats.totalAvailable),
        }))
        .sort((a, b) => b.merchantCount - a.merchantCount);
      return Response.json({
        ok: true,
        data: {
          banks: bankStats,
          totalMerchants: competitors.length,
          merchantsWithBanks: totalCompetitorsWithBanks,
          cycleAt: latest.cycleAt.toISOString(),
        },
      });
    }

    if (type === "oracle") {
      // Últimas lecturas del lado venta (nuestros competidores reales) para
      // dirección/régimen, y del lado compra (side="0") para el OBI.
      const sellSnaps = await prisma.p2PBotMarketSnapshot.findMany({
        where: { tenantId: session.tenantId, exchange, side: "1" },
        orderBy: { cycleAt: "desc" },
        take: 10,
      });
      const buySnaps = await prisma.p2PBotMarketSnapshot.findMany({
        where: { tenantId: session.tenantId, exchange, side: "0" },
        orderBy: { cycleAt: "desc" },
        take: 10,
      });

      if (!sellSnaps.length) {
        return Response.json({ ok: true, data: null });
      }

      // sellSnaps viene desc (mas reciente primero) -- lo volteamos para
      // calcular en orden cronológico.
      const chrono = [...sellSnaps].reverse();
      const top1Series = chrono.map((s) => {
        const comps = ((s.competitors as any[]) || []).slice().sort((a, b) => Number(a.price) - Number(b.price));
        return comps.length ? Number(comps[0].price) : null;
      }).filter((p): p is number => p !== null && p > 0);

      const ma = (arr: number[], n: number) => {
        const slice = arr.slice(-n);
        return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
      };
      const ma3 = ma(top1Series, 3);
      const ma10 = ma(top1Series, 10);
      const spreadMa = ma3 !== null && ma10 !== null && ma10 > 0 ? ((ma3 - ma10) / ma10) * 100 : 0;

      // Racha: cuántas lecturas consecutivas (desde la más reciente hacia
      // atrás) se movieron en la misma dirección.
      let racha = 0;
      let direccion: "alza" | "baja" | "lateral" = "lateral";
      for (let i = top1Series.length - 1; i > 0; i--) {
        const diff = top1Series[i] - top1Series[i - 1];
        if (diff === 0) break;
        const dir = diff > 0 ? "alza" : "baja";
        if (racha === 0) { direccion = dir; racha = 1; }
        else if (dir === direccion) racha++;
        else break;
      }

      let regimen: "RANGING" | "TRENDING" = Math.abs(spreadMa) < 0.10 ? "RANGING" : "TRENDING";

      // Última lectura del lado venta -- para WAP, asimetría y vacuum.
      const latestSell = sellSnaps[0];
      const sellComps = ((latestSell.competitors as any[]) || []).slice().sort((a: any, b: any) => Number(a.price) - Number(b.price));
      const sellVolume = sellComps.reduce((sum: number, c: any) => sum + Number(c.lastQuantity || 0), 0);
      const wapSell = sellVolume > 0
        ? sellComps.reduce((sum: number, c: any) => sum + Number(c.price) * Number(c.lastQuantity || 0), 0) / sellVolume
        : (sellComps[0] ? Number(sellComps[0].price) : 0);

      // Asimetría: comparamos el monto mínimo de entrada del anuncio más
      // chico (retail) contra el del anuncio con más volumen disponible
      // (ballena) -- ambos ya vienen en los datos reales del competidor.
      const byVolAsc = [...sellComps].sort((a: any, b: any) => Number(a.lastQuantity || 0) - Number(b.lastQuantity || 0));
      const retailMin = byVolAsc.length ? Number(byVolAsc[0].minAmount || 0) : 0;
      const whaleMin = byVolAsc.length ? Number(byVolAsc[byVolAsc.length - 1].minAmount || 0) : 0;
      const asimetriaPct = retailMin > 0 ? Math.abs(whaleMin - retailMin) / retailMin * 100 : 0;
      const asimetriaLabel = asimetriaPct > 40 ? "Alta" : asimetriaPct > 15 ? "Media" : "Baja";

      // Spread vacuum: hueco entre el 1er y 2do precio, como % del top1.
      const top1 = sellComps[0] ? Number(sellComps[0].price) : 0;
      const top2 = sellComps[1] ? Number(sellComps[1].price) : 0;
      const vacuumPct = top1 > 0 && top2 > 0 ? Math.abs(top2 - top1) / top1 * 100 : 0;
      const hasVacuum = vacuumPct > 0.5;

      // OBI: presión compra vs venta, comparando volumen disponible de
      // anuncios de compra vs anuncios de venta en lecturas emparejadas.
      const obiHistory: number[] = [];
      for (const bSnap of [...buySnaps].reverse()) {
        const buyComps = (bSnap.competitors as any[]) || [];
        const buyVol = buyComps.reduce((sum: number, c: any) => sum + Number(c.lastQuantity || 0), 0);
        // Emparejar con la lectura de venta más cercana en el tiempo.
        const closestSell = sellSnaps.reduce((best: any, s: any) => {
          const d = Math.abs(s.cycleAt.getTime() - bSnap.cycleAt.getTime());
          return !best || d < best.d ? { snap: s, d } : best;
        }, null as any)?.snap;
        const sVol = closestSell ? ((closestSell.competitors as any[]) || []).reduce((sum: number, c: any) => sum + Number(c.lastQuantity || 0), 0) : 0;
        const total = buyVol + sVol;
        obiHistory.push(total > 0 ? (buyVol / total) * 100 : 50);
      }
      const obiBuyPct = obiHistory.length ? obiHistory[obiHistory.length - 1] : 50;
      const obiSellPct = 100 - obiBuyPct;
      const oferta = obiSellPct > 60 ? "toxica" : obiBuyPct > 60 ? "demanda_fuerte" : "equilibrada";

      // Maker Score (0-100): metrica propia de ONZE, combina las señales de
      // arriba -- NO es una fórmula de terceros, es un puntaje propio para
      // ayudar a decidir cuándo operar. Parte de 50 (neutral) y suma/resta
      // según cada señal.
      let score = 50;
      score += hasVacuum ? 15 : -5; // un vacío es oportunidad para el maker
      score += obiBuyPct > 55 ? 10 : obiBuyPct < 45 ? -10 : 0; // demanda favorece vender
      score += regimen === "RANGING" ? 10 : -5; // mercado lateral = más predecible
      score += asimetriaLabel === "Baja" ? 5 : asimetriaLabel === "Alta" ? -10 : 0;
      score = Math.max(0, Math.min(100, Math.round(score)));

      const accion = score >= 70
        ? { emoji: "🚀", texto: "Operar ahora — señal favorable" }
        : score >= 45
          ? { emoji: "⏳", texto: "Esperar próxima lectura — señal moderada" }
          : { emoji: "⚠️", texto: "Precaución — condiciones desfavorables" };

      const recomendacion = regimen === "RANGING"
        ? "Mercado lateral. Opera con spreads ajustados y márgenes pequeños."
        : direccion === "alza"
          ? "Mercado en alza. Sigue la tendencia, no te quedes atrás del top 1."
          : "Mercado en baja. Cuidado con vender por debajo de tu piso de seguridad.";
      const recomendacionExtra = hasVacuum
        ? " Hay un vacío de precio: hueco entre el 1° y 2° competidor."
        : " Sin vacíos: competencia aglomerada, diferénciate por velocidad y límites.";

      return Response.json({
        ok: true,
        data: {
          cycleAt: latestSell.cycleAt.toISOString(),
          direccion,
          racha,
          regimen,
          spreadMa: Number(spreadMa.toFixed(4)),
          wapSell: Number(wapSell.toFixed(2)),
          score,
          accion,
          obiBuyPct: Number(obiBuyPct.toFixed(1)),
          obiSellPct: Number(obiSellPct.toFixed(1)),
          obiHistory: obiHistory.map((v) => Number(v.toFixed(1))),
          oferta,
          retailMin: Math.round(retailMin),
          whaleMin: Math.round(whaleMin),
          asimetriaLabel,
          vacuumPct: Number(vacuumPct.toFixed(2)),
          hasVacuum,
          recomendacion: recomendacion + recomendacionExtra,
          readingsCount: sellSnaps.length,
        },
      });
    }

    if (type === "insights") {
      const snapshots = await prisma.p2PBotMarketSnapshot.findMany({
        where: { tenantId: session.tenantId, exchange, side: "1" },
        orderBy: { cycleAt: "asc" },
        take: 60,
      });
      if (!snapshots.length) {
        return Response.json({ ok: true, data: null });
      }
      let positionCounts: number[] = [];
      let ourAdPresentCount = 0;
      let totalSpread12 = 0;
      let totalSpread13 = 0;
      let spreadSamples = 0;
      let totalDepthFirst10 = 0;
      let depthSamples = 0;
      let ourPriceDeviations: number[] = [];
      for (const snap of snapshots) {
        const comps = (snap.competitors as any[]) || [];
        const target = snap.targetPrice ? Number(snap.targetPrice) : null;
        const ourAd = snap.ourAd ? (snap.ourAd as any) : null;
        if (comps.length > 1) {
          const p1 = Number(comps[0].price);
          const p2 = Number(comps[1].price);
          totalSpread12 += Math.abs(p2 - p1);
          totalSpread13 += comps.length > 2 ? Math.abs(Number(comps[2].price) - p1) : 0;
          spreadSamples++;
        }
        const depth10 = comps.slice(0, 10).reduce((sum: number, c: any) => {
          return sum + Number(c.lastQuantity ?? c.quantity ?? 0);
        }, 0);
        totalDepthFirst10 += depth10;
        depthSamples++;
        let ourRank = -1;
        if (ourAd && ourAd.price) {
          ourAdPresentCount++;
          for (let i = 0; i < comps.length; i++) {
            if (Math.abs(Number(comps[i].price) - ourAd.price) < 0.01 &&
                (comps[i].nickName || comps[i].id) === ourAd.id?.toString()) {
              ourRank = i + 1;
              break;
            }
          }
          if (ourRank < 0) {
            for (let i = 0; i < comps.length; i++) {
              if (Math.abs(Number(comps[i].price) - ourAd.price) < 0.01) {
                ourRank = i + 1;
                break;
              }
            }
          }
          if (ourRank < 0) ourRank = comps.length + 1;
          positionCounts.push(ourRank);
          if (target) {
            ourPriceDeviations.push(Math.abs(ourAd.price - target));
          }
        }
      }
      const rankDistribution: Record<string, number> = {};
      for (const r of positionCounts) {
        const key = r <= 3 ? `top${r}` : r <= 5 ? "top5" : r <= 10 ? "top10" : "otros";
        rankDistribution[key] = (rankDistribution[key] || 0) + 1;
      }
      const snapCount = snapshots.length;
      return Response.json({
        ok: true,
        data: {
          totalSnapshots: snapCount,
          ourAdPresentPct: snapCount > 0 ? Math.round((ourAdPresentCount / snapCount) * 100) : 0,
          rankDistribution,
          avgSpread12: spreadSamples > 0 ? totalSpread12 / spreadSamples : 0,
          avgSpread13: spreadSamples > 0 ? totalSpread13 / spreadSamples : 0,
          avgDepthFirst10: depthSamples > 0 ? Math.round(totalDepthFirst10 / depthSamples) : 0,
          avgPriceDeviation: ourPriceDeviations.length > 0
            ? ourPriceDeviations.reduce((a, b) => a + b, 0) / ourPriceDeviations.length
            : 0,
          lastSnapshotAt: snapshots[snapCount - 1].cycleAt.toISOString(),
          firstSnapshotAt: snapshots[0].cycleAt.toISOString(),
        },
      });
    }

    // Default: latest snapshot with competitor ranking
    const latest = await prisma.p2PBotMarketSnapshot.findFirst({
      where: { tenantId: session.tenantId, exchange, side: "1" },
      orderBy: { cycleAt: "desc" },
    });

    if (!latest) {
      return Response.json({ ok: true, data: null });
    }

    const competitors = (latest.competitors as any[]) || [];
    const ranked = competitors
      .sort((a: any, b: any) => Number(a.price) - Number(b.price))
      .slice(0, limit)
      .map((c: any, i: number) => ({
        rank: i + 1,
        nickName: c.nickName,
        price: Number(c.price),
        minAmount: Number(c.minAmount ?? 0),
        maxAmount: Number(c.maxAmount ?? 0),
        available: Number(c.lastQuantity ?? 0),
        orderCount: Number(c.orderCount ?? 0),
        completionRate: Number(c.completionRate ?? 0),
        recentOrderCount: Number(c.recentOrderCount ?? 0),
        recentExecuteRate: Number(c.recentExecuteRate ?? 0),
        monthOrderCount: Number(c.monthOrderCount ?? 0),
        monthExecuteRate: Number(c.monthExecuteRate ?? 0),
        paymentMethods: (c.paymentMethods || []).map((pm: any) => ({
          name: pm.name,
          identifier: pm.identifier,
        })),
      }));

    return Response.json({
      ok: true,
      data: {
        cycleAt: latest.cycleAt.toISOString(),
        targetPrice: latest.targetPrice ? Number(latest.targetPrice) : null,
        ourAd: latest.ourAd ? { price: (latest.ourAd as any).price } : null,
        totalCompetitors: competitors.length,
        ranked,
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
