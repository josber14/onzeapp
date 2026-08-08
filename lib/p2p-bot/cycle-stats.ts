import { BinanceP2PClient } from "./binance-adapter";

// getOrders() no reenvía un filtro de status a Binance (el endpoint no lo soporta
// de forma confiable) — hay que filtrar acá por completadas, si no se suman
// órdenes canceladas/apeladas/en curso que nunca se pagaron de verdad.
//
// El rango de fecha (startTimestamp/endTimestamp) SÍ se filtra directo en
// Binance — es más confiable que traer páginas sueltas y filtrar acá: con
// volumen alto de órdenes, nuevas órdenes se insertan mientras se pagina,
// corriendo los límites de cada página y perdiendo órdenes reales en el medio
// (confirmado en vivo: un ciclo perdió más de la mitad de sus ventas por esto).
// endMs por defecto es "ahora", para el cálculo en vivo del ciclo activo.
//
// extraOrders: órdenes ya obtenidas por el caller de una lectura más fresca
// (ej. el chequeo de "¿hay algo pendiente?" de autoCloseCycle, hecho
// milisegundos antes de cerrar). El endpoint de historial que se pagina acá
// abajo (listUserOrderHistory) puede tardar unos segundos en indexar una
// orden que ACABA de completarse — es una inconsistencia eventual real de
// Binance, no un bug de paginación. Confirmado en vivo: el ciclo 12 se cerró
// sin su última orden (ya completada, ya vista como "no pendiente" por el
// chequeo previo) porque el buscador de historial todavía no la reflejaba en
// el instante exacto del cierre. Pasar esa lectura fresca acá evita perderla.
// Forma final (liviana) en la que se muestran/guardan las órdenes de un
// ciclo -- usado tanto para el detalle en vivo como para el snapshot que se
// persiste al cerrar (P2PCycle.ordersJson), así las dos vistas son
// exactamente el mismo formato.
export function mapCycleOrdersForDisplay(orders: any[]) {
  return (orders || [])
    .map((o: any) => ({
      orderNumber: o.orderNumber ?? o.orderNo ?? null,
      totalPrice: Number(o.totalPrice) || 0,
      amount: Number(o.amount) || 0,
      createTime: Number(o.createTime) || Number(o.createDate) || (o.executedAt ? new Date(o.executedAt).getTime() : null),
    }))
    .sort((a: any, b: any) => (a.createTime || 0) - (b.createTime || 0));
}

export async function computeCycleOrderStats(
  client: BinanceP2PClient,
  startMs: number,
  endMs?: number,
  extraOrders: any[] = []
) {
  const endTimestamp = endMs ?? Date.now();
  const allOrders: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const pageRes = await client.getOrders({ page, rows: 100, startTimestamp: startMs, endTimestamp });
    const pageData = pageRes?.data || [];
    if (pageData.length === 0) break;
    allOrders.push(...pageData);
  }

  const seen = new Set<string>();
  const merged: any[] = [];
  for (const o of [...allOrders, ...extraOrders]) {
    const id = o.orderNumber ?? o.orderNo;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(o);
  }

  // Por ahora "Ciclo de Ventas" solo cuenta ventas en CLP — la cuenta puede
  // tener anuncios en otras monedas (ej. VES) cuyas órdenes no deben mezclarse
  // en este total (confirmado en vivo: una orden en VES se sumó como si fuera
  // CLP, inflando el total real del ciclo). Si más adelante se quiere incluir
  // otras monedas, esto necesita un cambio explícito, no asumir CLP siempre.
  //
  // El rango de fecha se re-valida acá explícitamente (además del filtro que
  // ya hace Binance vía startTimestamp/endTimestamp) porque extraOrders puede
  // traer órdenes fuera de la ventana del ciclo actual.
  const cycleOrders = merged.filter((o: any) => {
    if (o.orderStatus !== "COMPLETED" || o.fiat !== "CLP") return false;
    const t = Number(o.createTime) || Number(o.createDate) || 0;
    return t >= startMs && t <= endTimestamp;
  });

  let totalUsdt = 0;
  let totalBinanceClp = 0;
  for (const o of cycleOrders) {
    totalUsdt += Number(o.amount) || 0;
    // El CLP no usa decimales, pero Binance a veces marca centavos (ej.
    // 999994.33) por cómo calcula internamente el monto — se redondea cada
    // orden ANTES de sumar, para que el total nunca arrastre fracciones de
    // peso que no existen en la vida real.
    totalBinanceClp += Math.round(Number(o.totalPrice) || 0);
  }

  const sortedByTime = [...cycleOrders].sort((a: any, b: any) => {
    const ta = Number(a.createTime) || Number(a.createDate) || 0;
    const tb = Number(b.createTime) || Number(b.createDate) || 0;
    return ta - tb;
  });
  const firstOrder = sortedByTime[0] || null;
  const lastOrder = sortedByTime[sortedByTime.length - 1] || null;

  return {
    totalUsdt,
    totalBinanceClp,
    orderCount: cycleOrders.length,
    firstOrder,
    lastOrder,
    // Lista completa para mostrar "qué órdenes van entrando" en el ciclo activo.
    orders: sortedByTime,
  };
}

// Estados que Binance/Bybit consideran definitivos como venta real completada
// (ver P2PBotOrder.status, guardado con el string crudo del exchange).
const COMPLETED_STATUSES = new Set(["COMPLETED", "completed"]);

// Para Bybit (y cualquier exchange sin una API de historial propia todavía
// integrada acá) usamos las órdenes que el propio ciclo del bot ya sincroniza
// a P2PBotOrder en cada vuelta (ver runBybitCycle en engine.ts, sección
// "Sync orders"). A diferencia de Binance, Bybit es una cuenta única sin
// variante ONZE/ZINPLE, así que no hay riesgo de mezclar cuentas al no
// filtrar por label acá.
export async function computeLocalCycleStats(
  prisma: any,
  tenantId: number,
  exchange: string,
  startMs: number,
  endMs?: number
) {
  const endTimestamp = endMs ?? Date.now();
  const rows = await prisma.p2PBotOrder.findMany({
    where: {
      tenantId,
      exchange,
      executedAt: { gte: new Date(startMs), lte: new Date(endTimestamp) },
    },
    orderBy: { executedAt: "asc" },
  });

  const completed = rows.filter((o: any) => COMPLETED_STATUSES.has(o.status));

  let totalUsdt = 0;
  let totalClp = 0;
  for (const o of completed) {
    totalUsdt += Number(o.amount) || 0;
    totalClp += Math.round(Number(o.totalPrice) || 0);
  }

  const firstOrder = completed[0] || null;
  const lastOrder = completed[completed.length - 1] || null;

  return {
    totalUsdt,
    totalBinanceClp: totalClp,
    orderCount: completed.length,
    firstOrder: firstOrder
      ? { orderNumber: firstOrder.orderNumber, totalPrice: firstOrder.totalPrice, createTime: firstOrder.executedAt.getTime() }
      : null,
    lastOrder: lastOrder
      ? { orderNumber: lastOrder.orderNumber, totalPrice: lastOrder.totalPrice, createTime: lastOrder.executedAt.getTime() }
      : null,
    orders: completed,
  };
}

// "Producción del bot": qué tanto trabajó el motor durante la ventana del
// ciclo — cambios de precio ejecutados y ciclos corridos — leído de
// P2PBotLog. Sirve para comparar cuánto se movió el bot vs. cuánto realmente
// se vendió, y para detectar ciclos donde el bot estuvo activo pero el
// mercado no dejó vender (mucha "producción", poca venta real).
export async function computeCycleProductionStats(
  prisma: any,
  tenantId: number,
  exchange: string,
  label: string,
  startMs: number,
  endMs?: number
) {
  const endTimestamp = endMs ?? Date.now();
  const range = { gte: new Date(startMs), lte: new Date(endTimestamp) };

  const [priceUpdates, cyclesRun] = await Promise.all([
    prisma.p2PBotLog.count({
      where: { tenantId, exchange, label, createdAt: range, message: { contains: "precio actualizado" } },
    }),
    prisma.p2PBotLog.count({
      where: { tenantId, exchange, label, createdAt: range, message: { contains: "Ciclo completado" } },
    }),
  ]);

  const hoursElapsed = Math.max((endTimestamp - startMs) / 3600000, 1 / 60);

  return {
    priceUpdates,
    cyclesRun,
    priceUpdatesPerHour: priceUpdates / hoursElapsed,
  };
}
