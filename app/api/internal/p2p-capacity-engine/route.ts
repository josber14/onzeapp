import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { computeP2PCapacityFifo, type FifoCapacityInput, type FifoSaleInput } from "@/lib/p2p-capacity-fifo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

// Junta las ventas reales de un tenant desde las 3 fuentes que hoy alimentan
// calculateP2PCapacityStats() en el navegador (Binance, todas las cuentas
// ONZE/ZINPLE; Bybit; ventas manuales) -- pero directo de Neon, sin límite
// de 500/100 filas como tienen las rutas de solo-lectura del panel (acá se
// necesita el historial COMPLETO para que el reparto FIFO sea correcto).
async function loadTenantSales(tenantId: number): Promise<FifoSaleInput[]> {
  const [binanceOrders, bybitOrders, manualSales] = await Promise.all([
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
  ]);

  const sales: FifoSaleInput[] = [];
  for (const o of binanceOrders) {
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

async function processTenant(tenantId: number) {
  const [capacityRows, settings] = await Promise.all([
    prisma.p2PCapacity.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { p2pCapacityServerAuthority: true },
    }),
  ]);
  if (!capacityRows.length) return { tenantId, skipped: true };

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
    prisma.p2PCapitalMarkedSale.findMany({ where: { tenantId }, select: { id: true } }),
  ]);
  const markedAsOwnCapital = new Set(markedRows.map((r) => r.id));
  const result = computeP2PCapacityFifo(capacities, sales, markedAsOwnCapital);

  const authoritative = !!settings?.p2pCapacityServerAuthority;
  const toFinish = result.capacities.filter((c) => c.shouldBeFinished);

  for (const cap of toFinish) {
    const action = authoritative ? "finished" : "would_finish";
    // Una sola fila por capacityId+action -- no repetir el mismo aviso/
    // acción en cada corrida de 5 min mientras siga en el mismo estado.
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
      // esté "finished" en Neon (una carrera con el navegador, o con esta
      // misma corrida si el capacity ya se marcó por otro motivo).
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

// Disparado cada 5 min por el cron de Vercel (ver vercel.json). Ver
// AGENTS.md, sección "Motor de Capacity del lado del servidor" -- por
// defecto corre en modo sombra (TenantSettings.p2pCapacityServerAuthority =
// false) para todos los tenants: calcula qué capacity marcaría como
// completado y solo lo anota en P2PCapacityEngineLog, sin tocar Neon. Recién
// actúa de verdad para un tenant cuando ese interruptor se prende a mano,
// después de varios días comparando el modo sombra contra lo que hizo el
// navegador.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const tenantIds = await prisma.p2PCapacity
    .findMany({ select: { tenantId: true }, distinct: ["tenantId"] })
    .then((rows) => rows.map((r) => r.tenantId));

  const results = [];
  for (const tenantId of tenantIds) {
    try {
      results.push(await processTenant(tenantId));
    } catch (e: any) {
      results.push({ tenantId, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
