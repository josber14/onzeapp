import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  if (session.role !== "super_admin_global" && session.role !== "super_admin_cliente") {
    return { error: NextResponse.json({ error: "No tienes permisos." }, { status: 403 }) };
  }
  if (!session.tenantId) return { error: NextResponse.json({ error: "Falta tenantId" }, { status: 400 }) };
  return { session };
}

// El panel hace polling acá para el campanita de notificaciones -- pedido
// explícito del usuario (ago 2026): saber apenas un cliente pide comprar (y
// si cancela) para poder fondear Skipo a tiempo.
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const [unreadCount, notifications] = await Promise.all([
    prisma.adminNotification.count({ where: { tenantId: session.tenantId!, read: false } }),
    prisma.adminNotification.findMany({
      where: { tenantId: session.tenantId! },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    unreadCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      clientName: n.clientName,
      requestedClp: n.requestedClp !== null ? Number(n.requestedClp) : null,
      skipoClpNeeded: n.skipoClpNeeded !== null ? Number(n.skipoClpNeeded) : null,
      walletAddress: n.walletAddress,
      withdrawalNetwork: n.withdrawalNetwork,
      purchaseIntentId: n.purchaseIntentId,
      read: n.read,
      createdAt: n.createdAt,
    })),
  });
}

// Marca como leídas -- { ids: [1,2,3] } o { all: true }.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const body = await req.json().catch(() => ({}));
  if (body.all === true) {
    await prisma.adminNotification.updateMany({
      where: { tenantId: session.tenantId!, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id: any) => Number(id)).filter((id: number) => id > 0) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "Falta ids" }, { status: 400 });

  await prisma.adminNotification.updateMany({
    where: { id: { in: ids }, tenantId: session.tenantId! },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
