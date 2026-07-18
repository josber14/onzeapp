import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeFifo } from "@/lib/partner-fifo";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";
const TZ = "America/Santiago";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Día calendario en hora de Chile (no UTC) — el socio y su propio bot cuentan
// "hoy" por hora de Chile, así que medianoche UTC no sirve como corte de día
// (queda desfasado ~4h, mezcla parte de ayer-tarde con hoy-temprano en Chile).
function chileDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Agrega el detalle por venta (ya con costo/ganancia calculado sobre TODO el
// historial) a un rango de días calendario de Chile [fromStr, toStr] — un
// solo día es un rango donde from === to. Así "hoy" se reinicia solo cada
// día, y un mes completo se puede sumar sin perder precisión del FIFO entre
// capacities (que corre una sola vez sobre TODO el historial).
function aggregateRange(saleBreakdown: ReturnType<typeof computeFifo>["saleBreakdown"], fromStr: string, toStr: string) {
  const rangeSales = saleBreakdown.filter((s) => {
    const d = chileDateStr(s.executedAt);
    return d >= fromStr && d <= toStr;
  });

  let totalUsdtSold = 0, totalCommissionUsdt = 0, totalClpReceived = 0, totalUsdtDrawn = 0;
  let totalCostClp = 0, matchedClp = 0, matchedUsdtDrawn = 0, unmatchedClp = 0, unmatchedUsdt = 0;

  for (const s of rangeSales) {
    totalUsdtSold += s.amount;
    totalCommissionUsdt += s.commission;
    totalClpReceived += s.clpTotal;
    totalUsdtDrawn += s.usdtDrawnTotal;
    totalCostClp += s.costClp;
    matchedClp += s.matchedClp;
    unmatchedClp += s.unmatchedClp;
    unmatchedUsdt += s.unmatchedUsdt;
    const ratio = s.clpTotal > 0 ? s.matchedClp / s.clpTotal : 0;
    matchedUsdtDrawn += s.usdtDrawnTotal * ratio;
  }

  const realProfitClp = matchedClp > 0 ? matchedClp - totalCostClp : null;
  const profitPct = totalCostClp > 0 && realProfitClp !== null ? (realProfitClp / totalCostClp) * 100 : null;
  const avgSalePrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : null;
  const weightedAvgBuyPrice = matchedUsdtDrawn > 0 ? totalCostClp / matchedUsdtDrawn : null;

  return {
    salesCount: rangeSales.length,
    totalUsdtSold,
    totalCommissionUsdt,
    totalUsdtDrawn,
    totalClpReceived,
    avgSalePrice,
    weightedAvgBuyPrice,
    totalCostClp: matchedClp > 0 ? totalCostClp : null,
    profitClp: realProfitClp,
    profitPct,
    matchedClp,
    unmatchedClp,
    unmatchedUsdt,
  };
}

function aggregateDay(saleBreakdown: ReturnType<typeof computeFifo>["saleBreakdown"], dateStr: string) {
  return aggregateRange(saleBreakdown, dateStr, dateStr);
}

// Desglose día por día dentro de un rango — solo los días que tuvieron
// ventas (evita relleno de días vacíos en el panel de estadísticas).
function dailyBreakdownForRange(saleBreakdown: ReturnType<typeof computeFifo>["saleBreakdown"], fromStr: string, toStr: string) {
  const days = new Set<string>();
  for (const s of saleBreakdown) {
    const d = chileDateStr(s.executedAt);
    if (d >= fromStr && d <= toStr) days.add(d);
  }
  return [...days].sort().reverse().map((d) => ({ date: d, ...aggregateRange(saleBreakdown, d, d) }));
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // Fecha (día calendario de Chile) que se muestra tanto en las tarjetas de
  // estadísticas como en la tabla de ventas — cambiar la fecha mueve ambas
  // cosas juntas, así se puede "buscar" cualquier día anterior. Default:
  // hoy en Chile (no UTC — Chile va 4h atrás, medianoche UTC queda desfasada).
  const dateParam = searchParams.get("date") || chileDateStr(new Date());
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

  const [account, capacities, allSales, manualPayments] = await Promise.all([
    prisma.partnerAccount.findUnique({ where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } } }),
    prisma.partnerCapacity.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerSale.findMany({ where: { tenantId: session.tenantId, label: LABEL } }),
    prisma.partnerCapacityPayment.findMany({ where: { capacity: { tenantId: session.tenantId, label: LABEL } } }),
  ]);

  // Las ventas anteriores a trackingStartDate se ignoran en TODO el cálculo
  // (estadísticas y tabla) — quedan guardadas en la base de datos por si
  // sirven de referencia después, pero no cuentan para "la cuenta arrancada
  // desde hoy" que pidió el usuario.
  const trackingStart = account?.trackingStartDate ?? null;
  const sales = trackingStart ? allSales.filter((s) => s.executedAt >= trackingStart) : allSales;

  const manualPaymentsByCapacity = new Map<string, number>();
  for (const p of manualPayments) {
    manualPaymentsByCapacity.set(p.capacityId, (manualPaymentsByCapacity.get(p.capacityId) || 0) + Number(p.amountClp));
  }

  const stats = computeFifo(capacities, sales, manualPaymentsByCapacity);

  // Modo "panel de estadísticas": rango de fechas (por ej. el mes completo)
  // en vez del día fijo de la pantalla principal — se pide con from/to.
  // Respuesta separada y liviana: no toca la transición de capacity ni pagina
  // la tabla de ventas, esto es solo para consultar números históricos.
  const fromParam = searchParams.get("from");
  if (fromParam) {
    const toParam = searchParams.get("to") || fromParam;
    const rangeStats = aggregateRange(stats.saleBreakdown, fromParam, toParam);
    const dailyBreakdown = dailyBreakdownForRange(stats.saleBreakdown, fromParam, toParam);
    return NextResponse.json({ ok: true, from: fromParam, to: toParam, rangeStats, dailyBreakdown });
  }

  // Transición automática a "completado": si una capacity quedó con su
  // capacityClp 100% cubierto y todavía figuraba "active", se pasa a
  // "finished" — una sola escritura, idempotente (no cambia nada si se
  // vuelve a calcular). No hay doble fuente de verdad: siempre se recalcula
  // desde las mismas filas de Neon, nunca desde un caché del cliente.
  const newlyCompleted = stats.perCapacityBreakdown.filter(
    (c) => c.isCompleted && c.status === "active"
  );
  if (newlyCompleted.length > 0) {
    await prisma.partnerCapacity.updateMany({
      where: { id: { in: newlyCompleted.map((c) => c.id) }, tenantId: session.tenantId, label: LABEL },
      data: { status: "finished", finishedAt: new Date() },
    });
    for (const c of stats.perCapacityBreakdown) {
      if (newlyCompleted.some((n) => n.id === c.id)) c.status = "finished";
    }
  }

  // La tabla de ventas muestra TODO el historial (paginado, más nueva
  // primero) — no se filtra por el día elegido. Pedido explícito del
  // usuario: las ventas no deben "desaparecer" al cambiar de día, solo las
  // tarjetas de arriba se reinician por día (ver dayStats más abajo).
  const allSalesSorted = [...sales].sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());

  const totalPages = Math.max(1, Math.ceil(allSalesSorted.length / limit));
  const pageSafe = Math.min(page, totalPages);
  const pageSales = allSalesSorted.slice((pageSafe - 1) * limit, pageSafe * limit);

  // Las tarjetas muestran el DÍA seleccionado (se reinician solas cada día),
  // no el acumulado — pedido explícito del usuario para poder comparar con
  // el bot de su socio, que también cuenta por día. El desglose por capacity
  // (Activos/Completados) sigue siendo acumulado — una capacity puede tardar
  // varios días en cubrirse, no tiene sentido "reiniciarla" cada día.
  const dayStats = aggregateDay(stats.saleBreakdown, dateParam);
  const responseStats = { ...dayStats, perCapacityBreakdown: stats.perCapacityBreakdown };

  return NextResponse.json({
    ok: true,
    stats: responseStats,
    salesCount: sales.length,
    capacitiesCount: capacities.length,
    trackingStartDate: trackingStart ? trackingStart.toISOString().slice(0, 10) : null,
    date: dateParam,
    page: pageSafe,
    totalPages,
    salesForDateCount: allSalesSorted.length,
    recentSales: pageSales.map((s) => ({
      orderNumber: s.orderNumber,
      amount: Number(s.amount),
      totalPrice: Number(s.totalPrice),
      unitPrice: Number(s.unitPrice),
      commission: s.commission !== null ? Number(s.commission) : 0,
      orderStatus: s.orderStatus,
      paymentMethod: s.paymentMethod,
      executedAt: s.executedAt.toISOString(),
    })),
  });
}
