import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeFifo, chileDateStr, aggregateRange } from "@/lib/partner-fifo";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
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

// Pedido explícito del usuario (jul 2026): historial de ganancia MES A MES
// al hacer click en "Capital P2P" -- mismo patrón que dailyBreakdownForRange
// pero agrupado por mes calendario de Chile (YYYY-MM) en vez de por día.
function monthlyBreakdownForRange(saleBreakdown: ReturnType<typeof computeFifo>["saleBreakdown"], fromStr: string, toStr: string) {
  const months = new Set<string>();
  for (const s of saleBreakdown) {
    const d = chileDateStr(s.executedAt);
    if (d >= fromStr && d <= toStr) months.add(d.slice(0, 7));
  }
  return [...months].sort().reverse().map((m) => ({ month: m, ...aggregateRange(saleBreakdown, `${m}-01`, `${m}-31`) }));
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
    const monthlyBreakdown = monthlyBreakdownForRange(stats.saleBreakdown, fromParam, toParam);
    return NextResponse.json({ ok: true, from: fromParam, to: toParam, rangeStats, dailyBreakdown, monthlyBreakdown });
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
    const justFinishedAt = new Date();
    await prisma.partnerCapacity.updateMany({
      where: { id: { in: newlyCompleted.map((c) => c.id) }, tenantId: session.tenantId, label: LABEL },
      data: { status: "finished", finishedAt: justFinishedAt },
    });
    for (const c of stats.perCapacityBreakdown) {
      if (newlyCompleted.some((n) => n.id === c.id)) {
        c.status = "finished";
        c.finishedAt = justFinishedAt;
      }
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

  // Modo combinado (ago 2026): antes el panel pedía esta ruta 3 VECES en
  // paralelo cada 15s (hoy / mes / histórico total), cada una recalculando
  // computeFifo() desde cero con sus propias 3 consultas a la base -- 9
  // consultas + 3 recorridos completos del FIFO por ciclo. Eso disparó el
  // uso de CPU en Vercel y provocó caídas reales por falta de memoria
  // (confirmado en logs de producción). computeFifo() ya se calculó UNA vez
  // arriba para las tarjetas del día -- acá se reusa ese mismo resultado
  // (aggregateRange es solo un filtro en memoria, no toca la base) para
  // devolver también el mes y el histórico total en la MISMA respuesta,
  // sin ninguna consulta ni cálculo adicional a la base.
  const includeRanges = searchParams.get("includeRanges") === "1";
  let monthStats: ReturnType<typeof aggregateRange> | undefined;
  let totalStats: ReturnType<typeof aggregateRange> | undefined;
  let monthlyBreakdown: ReturnType<typeof monthlyBreakdownForRange> | undefined;
  if (includeRanges) {
    const monthStart = dateParam.slice(0, 7) + "-01";
    monthStats = aggregateRange(stats.saleBreakdown, monthStart, dateParam);
    totalStats = aggregateRange(stats.saleBreakdown, "2000-01-01", dateParam);
    monthlyBreakdown = monthlyBreakdownForRange(stats.saleBreakdown, "2000-01-01", dateParam);
  }

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
    ...(includeRanges ? { monthStats, totalStats, monthlyBreakdown } : {}),
  });
}
