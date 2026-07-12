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
export async function computeCycleOrderStats(client: BinanceP2PClient, startMs: number, endMs?: number) {
  const endTimestamp = endMs ?? Date.now();
  const allOrders: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const pageRes = await client.getOrders({ page, rows: 100, startTimestamp: startMs, endTimestamp });
    const pageData = pageRes?.data || [];
    if (pageData.length === 0) break;
    allOrders.push(...pageData);
  }

  // Por ahora "Ciclo de Ventas" solo cuenta ventas en CLP — la cuenta puede
  // tener anuncios en otras monedas (ej. VES) cuyas órdenes no deben mezclarse
  // en este total (confirmado en vivo: una orden en VES se sumó como si fuera
  // CLP, inflando el total real del ciclo). Si más adelante se quiere incluir
  // otras monedas, esto necesita un cambio explícito, no asumir CLP siempre.
  const cycleOrders = allOrders.filter((o: any) => o.orderStatus === "COMPLETED" && o.fiat === "CLP");

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

  return { totalUsdt, totalBinanceClp, orderCount: cycleOrders.length, firstOrder, lastOrder };
}
