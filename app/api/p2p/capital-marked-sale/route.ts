import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Ventas marcadas como "capital propio" desde el aviso "Ventas sin
// compra/capacity detectadas" -- ver AGENTS.md y el comentario en
// prisma/schema.prisma sobre P2PCapitalMarkedSale. Antes esto vivía SOLO en
// localStorage (un total agregado, sin registrar qué órdenes puntuales se
// habían marcado) -- ni se sincronizaba entre dispositivos, ni excluía esas
// ventas del reparto real de calculateP2PCapacityStats(), así que volvían a
// "reaparecer" como ganancia nueva en cuanto se creaba un capacity nuevo.
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const items = await prisma.p2PCapitalMarkedSale.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { executedAt: "asc" },
  });

  return NextResponse.json({
    ok: true,
    items: items.map((it) => ({
      orderNumber: it.id,
      exchange: it.exchange,
      amount: Number(it.amount),
      totalPrice: Number(it.totalPrice),
      commission: Number(it.commission),
      executedAt: it.executedAt.toISOString(),
    })),
  });
}

// Body: { items: [{ orderNumber, exchange, amount, totalPrice, commission, executedAt }, ...] }
// Bulk -- el botón marca TODAS las ventas sin asignar del momento de una vez.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Falta items" }, { status: 400 });
  }

  for (const item of items) {
    const orderNumber = String(item?.orderNumber || "");
    if (!orderNumber) continue;
    const existing = await prisma.p2PCapitalMarkedSale.findUnique({ where: { id: orderNumber } });
    if (existing && existing.tenantId !== tenantId) continue; // nunca pisar una marca de otro tenant

    await prisma.p2PCapitalMarkedSale.upsert({
      where: { id: orderNumber },
      update: {},
      create: {
        id: orderNumber,
        tenantId,
        exchange: String(item.exchange || "binance"),
        amount: Number(item.amount || 0),
        totalPrice: Number(item.totalPrice || 0),
        commission: Number(item.commission || 0),
        executedAt: item.executedAt ? new Date(item.executedAt) : new Date(),
      },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const orderNumber = searchParams.get("orderNumber");
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber" }, { status: 400 });
  }

  await prisma.p2PCapitalMarkedSale.deleteMany({ where: { id: orderNumber, tenantId: session.tenantId } });

  return NextResponse.json({ ok: true });
}
