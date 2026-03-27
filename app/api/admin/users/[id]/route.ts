import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value || null;
    const session = verifySessionToken(token);

    if (!session) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    if (
      session.role !== "super_admin_global" &&
      session.role !== "super_admin_cliente"
    ) {
      return NextResponse.json(
        { error: "No tienes permisos para actualizar usuarios." },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    const userId = Number(id);

    if (!userId || Number.isNaN(userId)) {
      return NextResponse.json(
        { error: "ID de usuario inválido." },
        { status: 400 }
      );
    }

    if (userId === session.userId) {
      return NextResponse.json(
        { error: "No puedes cambiar tu propio rol o estado desde este panel." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { role, status } = body;

    const data: {
      role?: "super_admin_global" | "super_admin_cliente" | "operador";
      status?: "pendiente" | "activo" | "suspendido" | "rechazado";
      approvedAt?: Date | null;
      approvedByUserId?: number | null;
    } = {};

    if (role) {
      data.role = role;
    }

    if (status) {
      data.status = status;

      if (status === "activo") {
        data.approvedAt = new Date();
        data.approvedByUserId = session.userId;
      }

      if (status !== "activo") {
        data.approvedAt = null;
        data.approvedByUserId = null;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        approvedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error("ADMIN_USER_PATCH_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo actualizar el usuario." },
      { status: 500 }
    );
  }
}
