import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const orders = await prisma.binanceOrder.findMany({
      where: { tenantId: session.tenantId, fiat: "CLP" },
      orderBy: { createTime: "desc" },
      take: 100,
    });

    return Response.json({
      ok: true,
      total: orders.length,
      source: "database",
      orders: orders.map(o => ({
        orderNumber: o.orderNumber,
        amount: Number(o.amount),
        totalPrice: Number(o.totalPrice),
        unitPrice: Number(o.unitPrice),
        commission: Number(o.commission),
        orderStatus: o.orderStatus,
        createTime: Number(o.createTime),
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error consultando órdenes" },
      { status: 500 }
    );
  }
}
