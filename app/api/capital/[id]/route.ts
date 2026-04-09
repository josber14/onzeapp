import { NextResponse } from "next/server";
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

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const isAdmin =
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente";

    if (!isAdmin) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const { id } = await context.params;
    const capitalId = Number(id);

    if (!Number.isInteger(capitalId) || capitalId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const existing = await prisma.initialCapital.findFirst({
      where: {
        id: capitalId,
        tenantId: session.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Capital no encontrado." }, { status: 404 });
    }

    await prisma.initialCapital.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("CAPITAL_DELETE_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo eliminar el capital inicial." },
      { status: 500 }
    );
  }
}
