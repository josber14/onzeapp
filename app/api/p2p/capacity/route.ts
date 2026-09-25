import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function chileDayKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "";
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  return y && m && day ? `${y}-${m}-${day}` : "";
}

function chileMonthKey(d: Date): string {
  const key = chileDayKey(d);
  return key ? key.slice(0, 7) : "";
}

type RawSalePart = {
  orderNumber?: string;
  createdAt?: string;
  exchange?: string;
  assignedUsdt?: number;
  assignedClp?: number;
  unitPrice?: number;
  commissionUsdt?: number;
  buyPrice?: number;
};

// Capacitys terminados hace más de un mes calendario (Chile) se "aligeran"
// en esta respuesta: en vez de mandar el detalle venta-por-venta completo
// (finalSaleParts puede tener cientos de entradas en cuentas de alto
// volumen -- ver AGENTS.md, "Alivianar sesión de Hector"), se manda un
// resumen por día (dailyBuckets, suficiente para "Este mes"/"Total"/rango
// personalizado, que siempre agrupan por día) y una lista mínima de
// órdenes ya usadas (lockedOrders, solo para que la protección de "no
// contar una venta dos veces" siga funcionando). El detalle completo NUNCA
// se borra de la base de datos -- solo se deja de mandar en esta lista
// para capacitys viejos. Pedido explícito del usuario (sep 2026): nunca
// hace falta ver el detalle venta-por-venta de un capacity de hace más de
// un mes.
function summarizeOldCapacitySaleParts(parts: RawSalePart[], capBuyPrice: number) {
  const buckets = new Map<
    string,
    {
      day: string;
      exchange: string;
      soldUsdt: number;
      clpReceived: number;
      commissionUsdt: number;
      commissionClp: number;
      costClp: number;
      profitClp: number;
      orderNumbers: Set<string>;
    }
  >();
  const lockedOrders: { orderNumber: string; assignedClp: number }[] = [];

  for (const part of parts) {
    const orderNumber = String(part.orderNumber || "");
    const assignedClp = Number(part.assignedClp || 0);
    if (orderNumber) lockedOrders.push({ orderNumber, assignedClp });

    if (!part.createdAt) continue;
    const day = chileDayKey(new Date(part.createdAt));
    if (!day) continue;
    const exchange = part.exchange || "binance";
    const key = `${day}|${exchange}`;

    const assignedUsdt = Number(part.assignedUsdt || 0);
    const unitPrice = Number(part.unitPrice || 0);
    const commissionUsdt = Number(part.commissionUsdt || 0);
    const commissionClp = commissionUsdt * (unitPrice || 0);
    const partBuyPrice = Number(part.buyPrice || capBuyPrice);
    const costClp = assignedUsdt * partBuyPrice;
    const profitClp = assignedClp - costClp - commissionClp;

    let b = buckets.get(key);
    if (!b) {
      b = { day, exchange, soldUsdt: 0, clpReceived: 0, commissionUsdt: 0, commissionClp: 0, costClp: 0, profitClp: 0, orderNumbers: new Set() };
      buckets.set(key, b);
    }
    b.soldUsdt += assignedUsdt;
    b.clpReceived += assignedClp;
    b.commissionUsdt += commissionUsdt;
    b.commissionClp += commissionClp;
    b.costClp += costClp;
    b.profitClp += profitClp;
    if (orderNumber) b.orderNumbers.add(orderNumber);
  }

  const dailyBuckets = Array.from(buckets.values()).map((b) => ({
    day: b.day,
    exchange: b.exchange,
    soldUsdt: b.soldUsdt,
    clpReceived: b.clpReceived,
    commissionUsdt: b.commissionUsdt,
    commissionClp: b.commissionClp,
    costClp: b.costClp,
    profitClp: b.profitClp,
    ordersCount: b.orderNumbers.size,
  }));

  return { dailyBuckets, lockedOrders };
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const [items, settings] = await Promise.all([
    prisma.p2PCapacity.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { id: "asc" },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { p2pCapacityServerAuthority: true, p2pResetCutoff: true },
    }),
  ]);
  const currentMonthKey = chileMonthKey(new Date());
  const normalized = items.map((it: any) => {
    const rawParts: RawSalePart[] = Array.isArray(it.finalSaleParts) ? it.finalSaleParts : [];
    const finishedMonthKey = it.finishedAt ? chileMonthKey(it.finishedAt) : "";
    const isOld = it.status === "finished" && !!finishedMonthKey && finishedMonthKey < currentMonthKey;

    let finalSaleParts: any[] = rawParts;
    let dailyBuckets: ReturnType<typeof summarizeOldCapacitySaleParts>["dailyBuckets"] | undefined;
    let lockedOrders: ReturnType<typeof summarizeOldCapacitySaleParts>["lockedOrders"] | undefined;

    if (isOld && rawParts.length) {
      const summary = summarizeOldCapacitySaleParts(rawParts, Number(it.buyPrice));
      finalSaleParts = [];
      dailyBuckets = summary.dailyBuckets;
      lockedOrders = summary.lockedOrders;
    }

    return {
      id: it.id,
      provider: it.provider,
      capacityClp: Number(it.capacityClp),
      buyPrice: Number(it.buyPrice),
      usdtAmount: Number(it.usdtAmount),
      date: it.date,
      status: it.status,
      finishedAt: it.finishedAt ? it.finishedAt.toISOString() : null,
      finalSoldUsdt: it.finalSoldUsdt !== null ? Number(it.finalSoldUsdt) : null,
      finalClpReceived: it.finalClpReceived !== null ? Number(it.finalClpReceived) : null,
      finalCommissionUsdt: it.finalCommissionUsdt !== null ? Number(it.finalCommissionUsdt) : null,
      finalCommissionClp: it.finalCommissionClp !== null ? Number(it.finalCommissionClp) : null,
      finalSaleParts,
      saleParts: finalSaleParts,
      ...(dailyBuckets ? { dailyBuckets } : {}),
      ...(lockedOrders ? { lockedOrders } : {}),
      manualPaymentClp: it.manualPaymentClp !== null ? Number(it.manualPaymentClp) : null,
      manualPaymentsClp: it.manualPaymentsClp !== null ? Number(it.manualPaymentsClp) : null,
      manualPayments: it.manualPayments || [],
      createdAt: it.createdAt.toISOString(),
    };
  });
  return NextResponse.json({
    ok: true,
    items: normalized,
    // Ver AGENTS.md, "Motor de Capacity del lado del servidor" -- le avisa
    // al panel si esta cuenta ya está en modo autoritativo, para que deje de
    // auto-completar capacities por su cuenta (ver autoFinishP2PCapacities
    // en onze-panel.html).
    serverAuthority: !!settings?.p2pCapacityServerAuthority,
    // Fecha del último "Empezar de cero" (POST /api/p2p/reset), en ms epoch.
    // Reemplaza la vieja fecha de inicio "inventada" por cada navegador
    // (bug real confirmado sep 2026: localhost, web y celular mostraban
    // "Este mes"/"Capital P2P" distintos porque cada uno se guardaba su
    // propia fecha de corte en localStorage la primera vez que abría el
    // panel) -- ver getP2PCapacityBaselineTs() en onze-panel.html, que ahora
    // lee este valor en vez de auto-generar uno.
    resetCutoff: settings?.p2pResetCutoff ? Number(settings.p2pResetCutoff) : null,
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json();
  const item = body?.item;
  const manualAction = !!body?.manualAction;
  const { searchParams } = new URL(req.url);
  const confirmPost = searchParams.get("confirm");
  console.log("[P2P POST] from", session.email || session.tenantId, "id:", item?.id, "provider:", item?.provider, "confirm:", confirmPost, "referer:", req.headers.get("referer") || "none");

  if (!item?.id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const existing = await prisma.p2PCapacity.findUnique({ where: { id: String(item.id) } });
  if (existing && existing.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  const incomingStatus = String(item.status || "active");
  if (existing?.status === "finished" && incomingStatus === "active" && !confirmPost) {
    return NextResponse.json({ ok: false, error: "Capacity ya estaba finalizado en servidor" }, { status: 409 });
  }

  // Motor de Capacity del lado del servidor (ver AGENTS.md). Backstop de
  // respaldo para una pestaña vieja que no se enteró del modo autoritativo
  // (ver window.__p2pServerAuthority / autoFinishP2PCapacities en el panel):
  // si esta cuenta ya está en modo autoritativo, el cierre AUTOMÁTICO de un
  // capacity lo decide el cron del servidor, no el navegador. Un cierre
  // MANUAL explícito (manualAction=true, botón "Completar capacity") sigue
  // permitido siempre -- es una decisión deliberada del usuario, no el mismo
  // bug que este motor busca evitar.
  if (existing?.status === "active" && incomingStatus === "finished" && !manualAction) {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { p2pCapacityServerAuthority: true },
    });
    if (settings?.p2pCapacityServerAuthority) {
      return NextResponse.json(
        { ok: false, error: "Esta cuenta usa el motor de capacity del servidor -- el cierre automático lo hace el cron, no el navegador." },
        { status: 409 }
      );
    }
  }
  const data: any = {
    tenantId: session.tenantId,
    provider: String(item.provider || ""),
    capacityClp: Number(item.capacityClp || 0),
    buyPrice: Number(item.buyPrice || 0),
    usdtAmount: Number(item.usdtAmount || 0),
    date: String(item.date || ""),
    status: incomingStatus,
    finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
    finalSoldUsdt: item.finalSoldUsdt !== undefined && item.finalSoldUsdt !== null ? Number(item.finalSoldUsdt) : null,
    finalClpReceived: item.finalClpReceived !== undefined && item.finalClpReceived !== null ? Number(item.finalClpReceived) : null,
    finalCommissionUsdt: item.finalCommissionUsdt !== undefined && item.finalCommissionUsdt !== null ? Number(item.finalCommissionUsdt) : null,
    finalCommissionClp: item.finalCommissionClp !== undefined && item.finalCommissionClp !== null ? Number(item.finalCommissionClp) : null,
    finalSaleParts: (item.finalSaleParts && Array.isArray(item.finalSaleParts) ? item.finalSaleParts : null)
      || (item.saleParts && Array.isArray(item.saleParts) ? item.saleParts : null),
    manualPaymentClp: item.manualPaymentClp !== undefined && item.manualPaymentClp !== null ? Number(item.manualPaymentClp) : null,
    manualPaymentsClp: item.manualPaymentsClp !== undefined && item.manualPaymentsClp !== null ? Number(item.manualPaymentsClp) : null,
    manualPayments: Array.isArray(item.manualPayments) ? item.manualPayments : null,
  };
  const upserted = existing
    ? await prisma.p2PCapacity.update({ where: { id: String(item.id) }, data })
    : await prisma.p2PCapacity.create({ data: { id: String(item.id), ...data } });
  console.log("[P2P POST] upserted", upserted.id, "→ status:", upserted.status);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const confirmDelete = searchParams.get("confirm");

  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }

  // Protección anti-borrado automático:
  // Solo permitimos borrar si viene desde el botón manual del panel.
  if (confirmDelete !== "manual") {
    return NextResponse.json(
      { ok: false, error: "DELETE bloqueado: falta confirmación manual" },
      { status: 409 }
    );
  }

  await prisma.p2PCapacity.deleteMany({
    where: { id, tenantId: session.tenantId },
  });

  return NextResponse.json({ ok: true });
}
