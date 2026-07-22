import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { confirmManualMatch } from "@/lib/usdt-payment-matcher";

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
  return { session };
}

// Bandeja de transferencias que no se pudieron asociar solas a una compra
// (sin código de referencia, o solo un candidato dudoso por nombre) —
// requiere que el operador las revise antes de que cuenten para habilitar
// ningún "Comprar".
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const transfers = await prisma.usdtIncomingTransfer.findMany({
    where: { tenantId: session.tenantId, needsReview: true },
    orderBy: { receivedAt: "desc" },
    include: { purchaseIntent: { include: { client: { select: { fullName: true, email: true } } } } },
  });

  // Solicitudes abiertas (para que el operador elija a cuál asociar a mano).
  const openIntents = await prisma.usdtPurchaseIntent.findMany({
    where: { tenantId: session.tenantId, status: "awaiting_payment" },
    include: { client: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    transfers: transfers.map((t) => ({ ...t, amountClp: Number(t.amountClp) })),
    openIntents: openIntents.map((i) => ({ ...i, requestedClp: Number(i.requestedClp), receivedClp: Number(i.receivedClp) })),
  });
}

// Asocia una transferencia sin identificar a una solicitud específica (o la
// descarta, si es un pago que no corresponde a Activos Digitales) — única
// vía por la que un match por nombre puede terminar habilitando una compra.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  // Descarte masivo — "seleccionar todos" en la bandeja de revisión (ej.
  // limpiar de una vez el backlog histórico que dejó la primera lectura de
  // correos). Cada transferencia queda igual registrada (nunca se borra),
  // solo se marca como ya revisada y sin asociar a ninguna compra.
  if (Array.isArray(body.transferIds) && body.discard === true) {
    const ids = body.transferIds.map((id: any) => Number(id)).filter((id: number) => id > 0);
    const result = await prisma.usdtIncomingTransfer.updateMany({
      where: { id: { in: ids }, tenantId: session.tenantId },
      data: { needsReview: false, matchMethod: "manual", purchaseIntentId: null, reviewedByUserId: session.userId },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  const transferId = Number(body.transferId);
  if (!transferId) return NextResponse.json({ error: "Falta transferId" }, { status: 400 });

  const transfer = await prisma.usdtIncomingTransfer.findUnique({ where: { id: transferId } });
  if (!transfer || transfer.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Transferencia no encontrada" }, { status: 404 });
  }

  if (body.discard === true) {
    const updated = await prisma.usdtIncomingTransfer.update({
      where: { id: transferId },
      data: { needsReview: false, matchMethod: "manual", purchaseIntentId: null, reviewedByUserId: session.userId },
    });
    return NextResponse.json({ ok: true, transfer: updated });
  }

  const purchaseIntentId = Number(body.purchaseIntentId);
  if (!purchaseIntentId) return NextResponse.json({ error: "Falta purchaseIntentId" }, { status: 400 });

  const intent = await prisma.usdtPurchaseIntent.findUnique({ where: { id: purchaseIntentId } });
  if (!intent || intent.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }

  const updated = await confirmManualMatch(transferId, purchaseIntentId, session.userId);
  return NextResponse.json({ ok: true, transfer: updated });
}
