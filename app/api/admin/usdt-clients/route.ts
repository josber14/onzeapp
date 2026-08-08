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
  return { session };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const clients = await prisma.usdtClient.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, fullName: true, status: true,
      purchaseLimitClp: true, fixedMarginPct: true, createdAt: true, approvedAt: true, kycData: true,
    },
  });
  return NextResponse.json({
    ok: true,
    clients: clients.map((c) => ({
      ...c,
      purchaseLimitClp: c.purchaseLimitClp ? Number(c.purchaseLimitClp) : null,
      fixedMarginPct: c.fixedMarginPct !== null ? Number(c.fixedMarginPct) : null,
    })),
  });
}

// Aprobar/rechazar/suspender un cliente, o ajustar su límite de compra —
// una sola acción por llamada, siempre logueando quién la hizo.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const clientId = Number(body.clientId);
  if (!clientId) return NextResponse.json({ error: "Falta clientId" }, { status: 400 });

  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const data: Record<string, any> = {};
  if (body.status) {
    const validStatuses = ["pending_kyc", "pending_approval", "approved", "rejected", "suspended"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    data.status = body.status;
    if (body.status === "approved") {
      data.approvedAt = new Date();
      data.approvedByUserId = session.userId;
    }
  }
  if (body.purchaseLimitClp !== undefined) {
    data.purchaseLimitClp = body.purchaseLimitClp === null ? null : Number(body.purchaseLimitClp);
  }
  // % fijo de ESTE cliente — en blanco (null) vuelve a usar los tramos
  // generales por monto, ver app/api/usdt-client/quote/route.ts.
  if (body.fixedMarginPct !== undefined) {
    data.fixedMarginPct = body.fixedMarginPct === null || body.fixedMarginPct === "" ? null : Number(body.fixedMarginPct);
  }

  const updated = await prisma.usdtClient.update({ where: { id: clientId }, data });
  return NextResponse.json({
    ok: true,
    client: {
      ...updated,
      purchaseLimitClp: updated.purchaseLimitClp ? Number(updated.purchaseLimitClp) : null,
      fixedMarginPct: updated.fixedMarginPct !== null ? Number(updated.fixedMarginPct) : null,
    },
  });
}

// Borrado permanente -- SOLO para clientes rechazados, y solo si nunca
// tuvieron una compra o retiro que llegó a completarse (dinero real
// movido). Decisión explícita del usuario (ago 2026): clientes aprobados o
// suspendidos nunca se borran, se manejan solo con estado -- borrar acá
// haría cascade sobre UsdtPurchaseIntent/UsdtWithdrawal (onDelete: Cascade
// en el schema) y perdería el rastro de dinero real si alguna vez lo hubo.
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const clientId = Number(searchParams.get("id"));
  if (!clientId) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }
  if (client.status !== "rejected") {
    return NextResponse.json({ error: "Solo se pueden eliminar clientes rechazados" }, { status: 400 });
  }

  const [completedIntents, completedWithdrawals] = await Promise.all([
    prisma.usdtPurchaseIntent.count({ where: { clientId, status: "completed" } }),
    prisma.usdtWithdrawal.count({ where: { clientId, status: "completed" } }),
  ]);
  if (completedIntents > 0 || completedWithdrawals > 0) {
    return NextResponse.json({ error: "Este cliente tiene compras/retiros completados con dinero real — no se puede eliminar" }, { status: 400 });
  }

  await prisma.usdtClient.delete({ where: { id: clientId } });
  return NextResponse.json({ ok: true });
}
