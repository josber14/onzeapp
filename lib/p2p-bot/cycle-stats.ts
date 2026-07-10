import { BinanceP2PClient } from "./binance-adapter";

// getOrders() no reenvía un filtro de status a Binance (el endpoint no lo soporta
// de forma confiable) — hay que filtrar acá por completadas, si no se suman
// órdenes canceladas/apeladas/en curso que nunca se pagaron de verdad.
export async function computeCycleOrderStats(client: BinanceP2PClient, startMs: number) {
  const allOrders: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const pageRes = await client.getOrders({ page, rows: 100 });
    const pageData = pageRes?.data || [];
    if (pageData.length === 0) break;
    allOrders.push(...pageData);
  }

  const cycleOrders = allOrders.filter((o: any) => {
    if (o.orderStatus !== "COMPLETED") return false;
    const t = Number(o.createTime) || Number(o.createDate) || 0;
    return t >= startMs;
  });

  let totalUsdt = 0;
  let totalBinanceClp = 0;
  for (const o of cycleOrders) {
    totalUsdt += Number(o.amount) || 0;
    totalBinanceClp += Number(o.totalPrice) || 0;
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
