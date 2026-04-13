import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();

    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const isAdmin =
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente";

    const { id } = await context.params;
    const operationId = Number(id);

    if (!Number.isInteger(operationId) || operationId <= 0) {
      return NextResponse.json({ error: "ID de operación inválido." }, { status: 400 });
    }

    const existing = await prisma.operation.findFirst({
      where: {
        id: operationId,
        tenantId: session.tenantId,
        ...(isAdmin ? {} : { createdByUserId: session.userId }),
      },
      select: {
        id: true,
        deleted: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Operación no encontrada." }, { status: 404 });
    }

    if (existing.deleted) {
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    const updated = await prisma.operation.update({
      where: { id: operationId },
      data: {
        deleted: true,
        deletedAt: new Date(),
        status: "eliminada",
      },
      select: {
        id: true,
        deleted: true,
        deletedAt: true,
        status: true,
      },
    });

    return NextResponse.json({
      ok: true,
      operation: updated,
    });
  } catch (error) {
    console.error("OPERATION_PATCH_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo anular la operación." },
      { status: 500 }
    );
  }
}
