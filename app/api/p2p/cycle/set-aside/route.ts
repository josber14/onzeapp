import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Lista las ventas apartadas SIN RECLAMAR (esperando al próximo ciclo) de
// esta cuenta -- usado por el panel para mostrar el chip "N ventas apartadas".
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const label = searchParams.get("label") || "ONZE";
    const exchange = searchParams.get("exchange") || "binance";

    const orders = await prisma.p2PCycleSetAsideOrder.findMany({
      where: { tenantId: session.tenantId, exchange, label, claimedByCycleId: null },
      orderBy: { setAsideAt: "desc" },
    });
    return Response.json({ ok: true, orders });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// Saca una venta puntual del ciclo activo -- queda apartada (sin dueño) hasta
// que se inicie el próximo ciclo (ver start/route.ts, que la reclama).
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { orderNumber, amount, totalPrice, createTime } = body;
    const label = body.label || "ONZE";
    const exchange = body.exchange || "binance";
    if (!orderNumber || amount === undefined || totalPrice === undefined || !createTime) {
      return Response.json({ ok: false, error: "Faltan datos de la orden" }, { status: 400 });
    }

    const created = await prisma.p2PCycleSetAsideOrder.upsert({
      where: { tenantId_exchange_label_orderNumber: { tenantId: session.tenantId, exchange, label, orderNumber: String(orderNumber) } },
      update: {},
      create: {
        tenantId: session.tenantId,
        exchange,
        label,
        orderNumber: String(orderNumber),
        amount: Number(amount),
        totalPrice: Number(totalPrice),
        createTime: new Date(Number(createTime)),
      },
    });
    return Response.json({ ok: true, order: created });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// Devuelve una venta apartada (por error) al ciclo activo -- solo mientras
// sigue sin reclamar por ningún ciclo nuevo.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) return Response.json({ ok: false, error: "id requerido" }, { status: 400 });

    await prisma.p2PCycleSetAsideOrder.deleteMany({
      where: { id, tenantId: session.tenantId, claimedByCycleId: null },
    });
    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
