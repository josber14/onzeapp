import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const userId = Number(id);

    if (!userId || Number.isNaN(userId)) {
      return NextResponse.json(
        { error: "ID de usuario inválido." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { role, status } = body;

    const data: {
      role?: "super_admin_global" | "super_admin_cliente" | "operador";
      status?: "pendiente" | "activo" | "suspendido" | "rechazado";
      approvedAt?: Date | null;
    } = {};

    if (role) {
      data.role = role;
    }

    if (status) {
      data.status = status;

      if (status === "activo") {
        data.approvedAt = new Date();
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