import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { triggerCapacityEngineNow } from "@/lib/p2p-capacity-engine";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Ventas manuales (Bybit/OKX sin API conectada, o correcciones manuales de
// Binance) -- antes solo vivían en localStorage del panel, ver comentario en
// prisma/schema.prisma sobre P2PManualSale. Este endpoint las persiste en
// Neon para que sobrevivan a un cambio de navegador/dispositivo, igual que
// ya se hizo con /api/p2p/capacity.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const { searchParams } = new URL(req.url);
  const exchange = searchParams.get("exchange");

  const items = await prisma.p2PManualSale.findMany({
    where: { tenantId, ...(exchange ? { exchange } : {}) },
    orderBy: { executedAt: "desc" },
  });

  const orders = items.map((it: any) => ({
    orderNumber: it.id,
    tradeType: "SELL",
    asset: "USDT",
    fiat: "CLP",
    amount: Number(it.amount),
    totalPrice: Number(it.totalPrice),
    unitPrice: Number(it.unitPrice),
    commission: Number(it.commission),
    orderStatus: "COMPLETED",
    payMethodName: "Manual",
    counterPartNickName: "Manual",
    createTime: it.executedAt.getTime(),
    createdAt: it.executedAt.toISOString(),
    _manual: true,
    exchange: it.exchange,
  }));

  return NextResponse.json({ ok: true, orders });
}

// Pedido explícito del usuario (oct 2026): "1 solo proceso" -- antes, una
// venta manual (Binance/Bybit/OKX) había que cargarla DOS VECES: acá (para
// que cuente para ganancia/capacity) y de nuevo a mano con el botón
// "+ Venta Manual" del Ciclo de Ventas (para que cuente en el combinado /
// Resumen P2P del ciclo). Ahora, si hay un ciclo de VENTA activo para este
// exchange (y, para Binance, para el label correcto -- Bybit/OKX siempre
// usan "ONZE", igual que el resto del sistema de ciclos, ver
// combined-totals/route.ts), esta misma venta se suma sola a ese ciclo.
// Upsert por sourceManualSaleId -- idempotente, así un reintento de red
// (postP2PManualSaleToServer reintenta hasta 3 veces) nunca duplica la
// entrada del ciclo aunque dupliqué la llamada a este endpoint.
async function syncManualSaleToActiveCycle(tenantId: number, exchange: string, label: string, orderNumber: string, totalPrice: number) {
  try {
    const cycleLabel = exchange === "binance" ? label : "ONZE";
    const cycle = await prisma.p2PCycle.findFirst({
      where: { tenantId, exchange, label: cycleLabel, side: "SELL", status: "active" },
    });
    if (!cycle) return;

    const concept = `Venta manual ${exchange}`;
    await prisma.p2PCycleManualSale.upsert({
      where: { sourceManualSaleId: orderNumber },
      update: { amountClp: totalPrice, concept },
      create: { cycleId: cycle.id, concept, amountClp: totalPrice, sourceManualSaleId: orderNumber },
    });

    const totalManualClp = await prisma.p2PCycleManualSale.aggregate({
      where: { cycleId: cycle.id },
      _sum: { amountClp: true },
    });
    await prisma.p2PCycle.update({
      where: { id: cycle.id },
      data: { totalManualClp: totalManualClp._sum.amountClp || 0 },
    });
  } catch (e: any) {
    console.warn("[P2P manual-sale] No se pudo sumar al ciclo activo:", e?.message);
    // No bloquear el guardado de la venta manual por esto -- la venta ya
    // quedó guardada (lo que importa para ganancia/capacity); el ciclo se
    // puede sumar a mano como respaldo si esto llegara a fallar.
  }
}

// Borra, si existe, la entrada de ciclo que se había creado automáticamente
// para esta venta manual -- simétrico a syncManualSaleToActiveCycle(), para
// que borrar una venta manual (ej. cargada por error) no deje su monto
// pegado para siempre en el total del ciclo.
async function removeManualSaleFromCycle(orderNumber: string) {
  try {
    const row = await prisma.p2PCycleManualSale.findUnique({ where: { sourceManualSaleId: orderNumber } });
    if (!row) return;
    await prisma.p2PCycleManualSale.delete({ where: { id: row.id } });
    const totalManualClp = await prisma.p2PCycleManualSale.aggregate({
      where: { cycleId: row.cycleId },
      _sum: { amountClp: true },
    });
    await prisma.p2PCycle.update({
      where: { id: row.cycleId },
      data: { totalManualClp: totalManualClp._sum.amountClp || 0 },
    });
  } catch (e: any) {
    console.warn("[P2P manual-sale] No se pudo quitar del ciclo activo:", e?.message);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json();
  const item = body?.item;
  if (!item?.orderNumber || !item?.exchange) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber o exchange" }, { status: 400 });
  }

  const existing = await prisma.p2PManualSale.findUnique({ where: { id: String(item.orderNumber) } });
  if (existing && existing.tenantId !== tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const data = {
    tenantId,
    exchange: String(item.exchange),
    amount: Number(item.amount || 0),
    totalPrice: Number(item.totalPrice || 0),
    unitPrice: Number(item.unitPrice || 0),
    commission: Number(item.commission || 0),
    executedAt: item.createdAt ? new Date(item.createdAt) : new Date(),
  };

  await prisma.p2PManualSale.upsert({
    where: { id: String(item.orderNumber) },
    update: data,
    create: { id: String(item.orderNumber), ...data },
  });

  await syncManualSaleToActiveCycle(tenantId, data.exchange, String(item.label || "ONZE"), String(item.orderNumber), data.totalPrice);

  // Pedido explícito del usuario (oct 2026): un capacity que se completa al
  // 100% con esta venta no puede quedar "Activo" esperando hasta 30 min al
  // próximo cron -- se dispara el motor de inmediato, en el servidor (nunca
  // el cálculo inseguro del navegador), para que pase a "finished" en el
  // acto si corresponde.
  await triggerCapacityEngineNow(tenantId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }

  await prisma.p2PManualSale.deleteMany({ where: { id, tenantId } });
  await removeManualSaleFromCycle(id);

  return NextResponse.json({ ok: true });
}
