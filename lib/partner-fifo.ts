// Cálculo puro FIFO compartido entre /api/partner/dashboard (estadísticas) y
// /api/partner/capacity/orders (detalle de qué órdenes cubrieron cada
// capacity) — una sola fuente de verdad para no duplicar la lógica de reparto.

export interface CapacityOrderDetail {
  orderNumber: string;
  executedAt: Date;
  amount: number; // USDT total de esa orden (no solo lo tomado por este capacity)
  clpTotal: number; // CLP total de esa orden
  clpTaken: number; // CLP de esa orden que se le atribuyó a ESTE capacity
  usdtTaken: number; // USDT bruto (amount + comisión Binance) que se le atribuyó a ESTE capacity
  usdtTakenNet: number; // USDT neto (sin la comisión de Binance) que se le atribuyó a ESTE capacity
  costTaken: number; // costo en CLP de la porción de esta orden (usdtTaken bruto × buyPrice del capacity)
  paymentMethod: string | null;
}

export function computeFifo(
  capacities: any[],
  sales: any[],
  manualPaymentsByCapacity?: Map<string, number>,
  opts: { includeOrderDetail?: boolean } = {}
) {
  const includeOrderDetail = !!opts.includeOrderDetail;

  const orderedCapacities = [...capacities].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  // Un pago manual ya cubrió esa parte del capacity — el FIFO de ventas solo
  // debe repartir lo que queda después de descontarlo. Si no se resta acá,
  // el capacity sigue "absorbiendo" ventas reales hasta su monto TOTAL,
  // ignorando el pago manual, y el excedente nunca llega al siguiente
  // capacity activo aunque este ya esté marcado como completado.
  const clpRemaining = new Map<string, number>();
  for (const c of orderedCapacities) {
    const manualPaymentClp = manualPaymentsByCapacity?.get(c.id) || 0;
    clpRemaining.set(c.id, Math.max(Number(c.capacityClp) - manualPaymentClp, 0));
  }

  const orderedSales = [...sales].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime()
  );

  let totalUsdtSold = 0;
  let totalCommissionUsdt = 0;
  let totalUsdtDrawn = 0; // amount + commission: lo que realmente sale de la capacity/wallet
  let totalClpReceived = 0;
  let totalCostClp = 0;
  let matchedClp = 0;
  let matchedUsdtDrawn = 0;
  let unmatchedClp = 0;
  let unmatchedUsdt = 0;

  const usdtConsumedByCapacity = new Map<string, number>();
  const clpCoveredByCapacity = new Map<string, number>();
  const ordersByCapacity = includeOrderDetail ? new Map<string, CapacityOrderDetail[]>() : null;

  // Detalle por venta — permite después agrupar por día calendario (Chile)
  // sin tener que volver a correr el FIFO (que tiene que ser sobre TODO el
  // historial para que el "saldo restante" de cada capacity sea correcto,
  // aunque una capacity se termine de cubrir en un día distinto al que se
  // quiere mostrar).
  const saleBreakdown: Array<{
    orderNumber: string; executedAt: Date; amount: number; commission: number; clpTotal: number;
    usdtDrawnTotal: number; costClp: number; matchedClp: number; unmatchedClp: number; unmatchedUsdt: number;
  }> = [];

  for (const s of orderedSales) {
    const commission = Number(s.commission || 0);
    const usdtDrawnTotal = Number(s.amount) + commission; // USDT real que sale de la capacity/wallet
    const clpTotal = Number(s.totalPrice);
    totalUsdtSold += Number(s.amount);
    totalCommissionUsdt += commission;
    totalUsdtDrawn += usdtDrawnTotal;
    totalClpReceived += clpTotal;

    let clpToAllocate = clpTotal;
    let saleCostClp = 0;
    let saleMatchedClp = 0;
    for (const c of orderedCapacities) {
      if (clpToAllocate <= 0) break;
      const avail = clpRemaining.get(c.id) || 0;
      if (avail <= 0) continue;
      const takeClp = Math.min(avail, clpToAllocate);
      const ratio = clpTotal > 0 ? takeClp / clpTotal : 0;
      const takeUsdt = usdtDrawnTotal * ratio;

      clpRemaining.set(c.id, avail - takeClp);
      clpCoveredByCapacity.set(c.id, (clpCoveredByCapacity.get(c.id) || 0) + takeClp);
      usdtConsumedByCapacity.set(c.id, (usdtConsumedByCapacity.get(c.id) || 0) + takeUsdt);

      const costForThisCapacity = takeUsdt * Number(c.buyPrice);

      if (ordersByCapacity) {
        const list = ordersByCapacity.get(c.id) || [];
        list.push({
          orderNumber: s.orderNumber,
          executedAt: s.executedAt,
          amount: Number(s.amount),
          clpTotal,
          clpTaken: takeClp,
          usdtTaken: takeUsdt,
          usdtTakenNet: Number(s.amount) * ratio, // sin la comisión de Binance
          costTaken: costForThisCapacity,
          paymentMethod: s.paymentMethod ?? null,
        });
        ordersByCapacity.set(c.id, list);
      }

      totalCostClp += costForThisCapacity;
      saleCostClp += costForThisCapacity;
      matchedClp += takeClp;
      matchedUsdtDrawn += takeUsdt;
      saleMatchedClp += takeClp;
      clpToAllocate -= takeClp;
    }
    const saleUnmatchedClp = Math.max(clpToAllocate, 0);
    const saleUnmatchedUsdt = clpTotal > 0 ? usdtDrawnTotal * (saleUnmatchedClp / clpTotal) : 0;
    if (clpToAllocate > 0) {
      unmatchedClp += clpToAllocate;
      unmatchedUsdt += saleUnmatchedUsdt;
    }
    saleBreakdown.push({
      orderNumber: s.orderNumber, executedAt: s.executedAt, amount: Number(s.amount), commission,
      clpTotal, usdtDrawnTotal, costClp: saleCostClp, matchedClp: saleMatchedClp,
      unmatchedClp: saleUnmatchedClp, unmatchedUsdt: saleUnmatchedUsdt,
    });
  }

  // Ganancia solo se puede afirmar con exactitud sobre la porción con costo conocido.
  const realProfitClp = matchedClp > 0 ? matchedClp - totalCostClp : null;
  const profitPct = totalCostClp > 0 && realProfitClp !== null ? (realProfitClp / totalCostClp) * 100 : null;

  const avgSalePrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : null;
  const weightedAvgBuyPrice = matchedUsdtDrawn > 0 ? totalCostClp / matchedUsdtDrawn : null;

  const CLP_EPSILON = 1; // el CLP no usa decimales — menos de $1 pendiente cuenta como cubierto

  const perCapacityBreakdown = orderedCapacities.map((c) => {
    const capacityClp = Number(c.capacityClp);
    const clpCovered = clpCoveredByCapacity.get(c.id) || 0;
    // Pagos manuales (ej: el socio le pagó al proveedor con plata propia,
    // fuera de una venta) — solo restan del saldo pendiente que se muestra.
    // NUNCA entran a clpCovered/usdtConsumed/costClp, así que jamás afectan
    // el cálculo de costo o ganancia (eso sale solo de ventas reales, arriba).
    const manualPaymentClp = manualPaymentsByCapacity?.get(c.id) || 0;
    const clpPending = Math.max(capacityClp - clpCovered - manualPaymentClp, 0);
    const usdtConsumed = usdtConsumedByCapacity.get(c.id) || 0;
    const usdtAmount = Number(c.usdtAmount);
    return {
      id: c.id,
      provider: c.provider,
      date: c.date,
      status: c.status,
      finishedAt: c.finishedAt || null,
      buyPrice: Number(c.buyPrice),
      capacityClp,
      usdtAmount,
      clpCovered,
      manualPaymentClp,
      clpPending,
      usdtConsumed,
      usdtRemaining: Math.max(usdtAmount - usdtConsumed, 0),
      costClp: usdtConsumed * Number(c.buyPrice),
      isCompleted: clpPending <= CLP_EPSILON,
      orders: ordersByCapacity ? (ordersByCapacity.get(c.id) || []) : undefined,
    };
  });

  return {
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
    matchedUsdtDrawn,
    unmatchedClp,
    unmatchedUsdt,
    perCapacityBreakdown,
    saleBreakdown,
  };
}

const TZ = "America/Santiago";

// Día calendario en hora de Chile (no UTC) — el socio y su propio bot cuentan
// "hoy" por hora de Chile, así que medianoche UTC no sirve como corte de día
// (queda desfasado ~4h, mezcla parte de ayer-tarde con hoy-temprano en Chile).
// Usada por /api/partner/dashboard para agregar por día/mes en la misma
// zona horaria que ve el usuario en el panel de estadísticas.
export function chileDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Agrega el detalle por venta (ya con costo/ganancia calculado sobre TODO el
// historial vía computeFifo) a un rango de días calendario de Chile [fromStr,
// toStr] — un solo día es un rango donde from === to.
export function aggregateRange(saleBreakdown: ReturnType<typeof computeFifo>["saleBreakdown"], fromStr: string, toStr: string) {
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
