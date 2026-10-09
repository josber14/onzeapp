import { prisma } from "@/lib/prisma";
import { computeP2PCapacityFifo, type FifoCapacityInput, type FifoSaleInput } from "@/lib/p2p-capacity-fifo";

// Motor de Capacity del lado del servidor -- ver AGENTS.md, "Motor de
// Capacity del lado del servidor". Extraído de
// app/api/internal/p2p-capacity-engine/route.ts (oct 2026, pedido explícito
// del usuario: "no se puede quedar ese capacity ahí de primero si ya se
// completó, tiene que ir a completado de una") para poder llamarlo tanto
// desde el cron de cada 30 min COMO al instante, justo después de que entra
// una venta real o manual -- así un capacity que se completa de golpe no
// tiene que esperar hasta el próximo tick del cron para reflejarlo.

// Junta las ventas reales de un tenant desde las 3 fuentes que hoy
// alimentan calculateP2PCapacityStats() en el navegador (Binance, todas las
// cuentas ONZE/ZINPLE; Bybit; ventas manuales) -- pero directo de Neon, sin
// límite de 500/100 filas como tienen las rutas de solo-lectura del panel
// (acá se necesita el historial COMPLETO para que el reparto FIFO sea
// correcto).
async function loadTenantSales(tenantId: number): Promise<FifoSaleInput[]> {
  const [binanceOrders, bybitOrders, manualSales, settings] = await Promise.all([
    prisma.p2PBotOrder.findMany({
      where: { tenantId, exchange: "binance", tradeType: "SELL", fiat: "CLP", status: "COMPLETED" },
      select: { orderNumber: true, amount: true, totalPrice: true, unitPrice: true, commission: true, executedAt: true },
    }),
    prisma.bybitOrder.findMany({
      where: { tenantId, tradeType: "SELL", fiat: "CLP", orderStatus: "COMPLETED" },
      select: { orderNumber: true, amount: true, totalPrice: true, unitPrice: true, commission: true, createdAt: true },
    }),
    prisma.p2PManualSale.findMany({
      where: { tenantId },
      select: { id: true, exchange: true, amount: true, totalPrice: true, unitPrice: true, commission: true, executedAt: true },
    }),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { p2pResetCutoff: true } }),
  ]);

  // Bug real confirmado en vivo (oct 2026, plata real afectada): el motor del
  // SERVIDOR (este archivo -- usado tanto por el cron como por "Completar
  // saldo") nunca respetaba p2pResetCutoff ("Empezar de cero"), a diferencia
  // del navegador (ver getP2PCapacityBaselineTs/calculateP2PCapacityStats en
  // onze-panel.html, que SÍ lo filtra). Resultado: una venta de MESES antes
  // del reinicio, invisible en el panel, podía reaparecer por el lado del
  // servidor y colarse en un capacity nuevo (confirmado: una venta real del
  // 9 de julio apareciendo en un capacity creado en octubre, pese a que el
  // navegador ya no la mostraba). Ahora ambos motores aplican el mismo corte.
  const cutoff = settings?.p2pResetCutoff ? Number(settings.p2pResetCutoff) : 0;

  const sales: FifoSaleInput[] = [];
  for (const o of binanceOrders) {
    if (cutoff && o.executedAt.getTime() < cutoff) continue;
    sales.push({
      orderNumber: o.orderNumber,
      exchange: "binance",
      amount: Number(o.amount),
      totalPrice: Number(o.totalPrice),
      unitPrice: Number(o.unitPrice),
      commission: Number(o.commission || 0),
      executedAt: o.executedAt,
    });
  }
  for (const o of bybitOrders) {
    if (cutoff && o.createdAt.getTime() < cutoff) continue;
    sales.push({
      orderNumber: o.orderNumber,
      exchange: "bybit",
      amount: Number(o.amount),
      totalPrice: Number(o.totalPrice),
      unitPrice: Number(o.unitPrice),
      commission: Number(o.commission || 0),
      executedAt: o.createdAt,
    });
  }
  for (const m of manualSales) {
    if (cutoff && new Date(m.executedAt).getTime() < cutoff) continue;
    sales.push({
      orderNumber: m.id,
      exchange: m.exchange,
      amount: Number(m.amount),
      totalPrice: Number(m.totalPrice),
      unitPrice: Number(m.unitPrice),
      commission: Number(m.commission || 0),
      executedAt: m.executedAt,
    });
  }
  return sales;
}

// Cálculo FIFO fresco, de solo lectura -- NO escribe nada en Neon. Pensado
// para validar una acción del cliente (ej. "Completar saldo") contra la
// verdad del servidor antes de aceptarla, sin los efectos secundarios de
// processTenantCapacityEngine() (que si puede cerrar capacitys). Reusa la
// misma fuente de datos que el motor real, así nunca puede dar un número
// distinto al que el cron/disparo inmediato ya usan.
export async function computeFreshCapacityFifoResult(tenantId: number) {
  const capacityRows = await prisma.p2PCapacity.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  if (!capacityRows.length) return null;

  const capacities: FifoCapacityInput[] = capacityRows.map((c) => ({
    id: c.id,
    capacityClp: Number(c.capacityClp),
    buyPrice: Number(c.buyPrice),
    usdtAmount: Number(c.usdtAmount),
    date: c.date,
    createdAt: c.createdAt,
    status: c.status,
    manualPaymentsClp: Number(c.manualPaymentsClp || 0),
    finalSoldUsdt: c.finalSoldUsdt !== null ? Number(c.finalSoldUsdt) : null,
    finalClpReceived: c.finalClpReceived !== null ? Number(c.finalClpReceived) : null,
    finalCommissionUsdt: c.finalCommissionUsdt !== null ? Number(c.finalCommissionUsdt) : null,
    finalCommissionClp: c.finalCommissionClp !== null ? Number(c.finalCommissionClp) : null,
    finalSaleParts: Array.isArray(c.finalSaleParts) ? (c.finalSaleParts as any) : null,
  }));

  const [sales, markedRows] = await Promise.all([
    loadTenantSales(tenantId),
    prisma.p2PCapitalMarkedSale.findMany({ where: { tenantId }, select: { id: true, totalPrice: true } }),
  ]);
  const markedAsOwnCapital = new Map(markedRows.map((r) => [r.id, Number(r.totalPrice)]));
  return computeP2PCapacityFifo(capacities, sales, markedAsOwnCapital);
}

// Candado de solo este tenant (ver comentario completo junto al campo en
// prisma/schema.prisma) -- evita que 2 corridas de processTenantCapacityEngine
// se solapen para la misma cuenta. TTL de 60s: de sobra para una corrida
// normal (lee capacitys+ventas, calcula en memoria, escribe); si una corrida
// se cuelga de verdad, el candado igual se libera solo pasado ese tiempo.
async function claimCapacityEngineLock(tenantId: number): Promise<boolean> {
  const lockMs = 60000;
  const result = await prisma.tenantSettings.updateMany({
    where: {
      tenantId,
      OR: [{ capacityEngineLockUntil: null }, { capacityEngineLockUntil: { lt: new Date() } }],
    },
    data: { capacityEngineLockUntil: new Date(Date.now() + lockMs) },
  });
  return result.count > 0;
}

async function releaseCapacityEngineLock(tenantId: number): Promise<void> {
  await prisma.tenantSettings.updateMany({ where: { tenantId }, data: { capacityEngineLockUntil: null } });
}

export async function processTenantCapacityEngine(tenantId: number) {
  // Bug real confirmado en vivo (oct 2026, cuenta de Hector, plata real
  // afectada): sin este candado, 2 disparos casi simultáneos (ej. una venta
  // de Binance y una de Bybit sincronizando casi al mismo tiempo) corrían
  // esta función en PARALELO -- cada uno leía el mismo snapshot de
  // capacitys ANTES de que el otro guardara su resultado, y ambos le
  // asignaban la MISMA venta real completa a un capacity DISTINTO,
  // duplicando el monto (confirmado: una misma orden contada completa en
  // 2, 3 y hasta 4 capacitys a la vez). Si no se puede tomar el candado,
  // esta corrida se salta entera -- el cron de cada 30 min, o el próximo
  // disparo real, la termina agarrando igual con datos frescos.
  const gotLock = await claimCapacityEngineLock(tenantId);
  if (!gotLock) {
    return { tenantId, skipped: true, reason: "ya hay otra corrida del motor de capacity en curso para este tenant" };
  }
  try {
    return await processTenantCapacityEngineLocked(tenantId);
  } finally {
    await releaseCapacityEngineLock(tenantId);
  }
}

async function processTenantCapacityEngineLocked(tenantId: number) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { p2pCapacityServerAuthority: true },
  });
  const result = await computeFreshCapacityFifoResult(tenantId);
  if (!result) return { tenantId, skipped: true };

  const authoritative = !!settings?.p2pCapacityServerAuthority;
  const toFinish = result.capacities.filter((c) => c.shouldBeFinished);

  for (const cap of toFinish) {
    const action = authoritative ? "finished" : "would_finish";
    // Una sola fila por capacityId+action -- no repetir el mismo aviso/
    // acción cada vez que esto corre mientras siga en el mismo estado.
    const already = await prisma.p2PCapacityEngineLog.findUnique({
      where: { capacityId_action: { capacityId: cap.id, action } },
    }).catch(() => null);
    if (already) continue;

    await prisma.p2PCapacityEngineLog.create({
      data: {
        tenantId,
        capacityId: cap.id,
        action,
        computedClp: cap.clpReceived,
        computedUsdt: cap.usedUsdt,
      },
    });

    if (authoritative) {
      // Backstop igual al de /api/p2p/capacity: no pisar un capacity que ya
      // esté "finished" en Neon (una carrera con otra corrida de esto mismo,
      // o con el cron de cada 30 min corriendo casi al mismo tiempo).
      await prisma.p2PCapacity.updateMany({
        where: { id: cap.id, tenantId, status: "active" },
        data: {
          status: "finished",
          finishedAt: cap.proposedFinishedAt || new Date(),
          finalSoldUsdt: cap.usedUsdt,
          finalClpReceived: cap.clpReceived,
          finalCommissionUsdt: cap.commissionUsdt,
          finalCommissionClp: cap.commissionClp,
          finalSaleParts: cap.saleParts as any,
        },
      });
    }
  }

  return {
    tenantId,
    authoritative,
    capacitiesEvaluated: result.capacities.length,
    newlyFinished: toFinish.length,
    unassignedSales: result.unassignedSales.length,
  };
}

// Dispara el motor para un tenant justo después de guardar una venta real o
// manual, en caliente -- pensado para que el caller lo llame con `await`
// (en funciones serverless no hay garantía de que un fire-and-forget sin
// esperar termine antes de que Vercel recicle la instancia). Nunca tira el
// error hacia arriba -- si el cálculo falla, el cron de cada 30 min lo
// termina agarrando igual; lo que no puede pasar es que un error acá tumbe
// la respuesta de guardar la venta real.
export async function triggerCapacityEngineNow(tenantId: number) {
  try {
    await processTenantCapacityEngine(tenantId);
  } catch (e: any) {
    console.warn("[p2p-capacity-engine] error en disparo inmediato para tenant", tenantId, e?.message || e);
  }
}
