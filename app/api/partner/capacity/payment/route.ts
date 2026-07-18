import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Pago manual aparte de las ventas sincronizadas de Binance (ej: el socio le
// pagó directo al proveedor con plata propia). Se guarda como registro
// propio en PartnerCapacityPayment — NUNCA se resta directo de
// capacityClp, y nunca entra al cálculo de costo/ganancia (ver computeFifo
// en /api/partner/dashboard, que solo usa PartnerSale para eso). Solo resta
// del saldo pendiente que se le muestra al socio.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const capacityId = searchParams.get("capacityId");
  if (!capacityId) {
    return NextResponse.json({ ok: false, error: "Falta capacityId" }, { status: 400 });
  }
  const capacity = await prisma.partnerCapacity.findFirst({
    where: { id: capacityId, tenantId: session.tenantId, label: LABEL },
  });
  if (!capacity) {
    return NextResponse.json({ ok: false, error: "Capacity no encontrado" }, { status: 404 });
  }
  const payments = await prisma.partnerCapacityPayment.findMany({
    where: { capacityId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    ok: true,
    items: payments.map((p) => ({
      id: p.id,
      amountClp: Number(p.amountClp),
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const capacityId = String(body?.capacityId || "");
  const amountClp = Number(body?.amountClp || 0);
  const note = body?.note ? String(body.note).slice(0, 500) : null;

  if (!capacityId) {
    return NextResponse.json({ ok: false, error: "Falta capacityId" }, { status: 400 });
  }
  if (!(amountClp > 0)) {
    return NextResponse.json({ ok: false, error: "El monto debe ser mayor a 0" }, { status: 400 });
  }

  const capacity = await prisma.partnerCapacity.findFirst({
    where: { id: capacityId, tenantId: session.tenantId, label: LABEL },
  });
  if (!capacity) {
    return NextResponse.json({ ok: false, error: "Capacity no encontrado" }, { status: 404 });
  }

  await prisma.partnerCapacityPayment.create({
    data: { capacityId, amountClp, note },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const confirmDelete = searchParams.get("confirm");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  if (confirmDelete !== "manual") {
    return NextResponse.json({ ok: false, error: "DELETE bloqueado: falta confirmación manual" }, { status: 409 });
  }
  // Confirmar que el pago pertenece a un capacity de este tenant antes de borrar.
  const payment = await prisma.partnerCapacityPayment.findUnique({
    where: { id: Number(id) },
    include: { capacity: true },
  });
  if (!payment || payment.capacity.tenantId !== session.tenantId || payment.capacity.label !== LABEL) {
    return NextResponse.json({ ok: false, error: "Pago no encontrado" }, { status: 404 });
  }
  await prisma.partnerCapacityPayment.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
