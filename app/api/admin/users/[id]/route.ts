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
        { error: "No puedes cambiar tu propia cuenta desde este panel." },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existingUser) {
      return NextResponse.json(
        { error: "El usuario no existe." },
        { status: 404 }
      );
    }

    if (
      session.role === "super_admin_cliente" &&
      existingUser.tenantId !== session.tenantId
    ) {
      return NextResponse.json(
        { error: "No puedes editar usuarios de otro tenant." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      role,
      status,
      tenantId,
      operatorMode,
      dataSourceMode,
      percentageRate,
      partnerSharePercent,
      canManageOperators,
      canConnectOwnSheet,
    } = body;

    const data: {
      role?: "super_admin_global" | "super_admin_cliente" | "operador";
      status?: "pendiente" | "activo" | "suspendido" | "rechazado";
      tenantId?: number | null;
      operatorMode?: "porcentaje" | "libre" | "socio" | "proveedor" | "manual" | null;
      dataSourceMode?: "base_onze" | "base_propia" | null;
      percentageRate?: number | null;
      partnerSharePercent?: number | null;
      canManageOperators?: boolean;
      canConnectOwnSheet?: boolean;
      approvedAt?: Date | null;
      approvedByUserId?: number | null;
    } = {};

    if (role) {
      if (session.role === "super_admin_cliente" && role === "super_admin_global") {
        return NextResponse.json(
          { error: "No puedes asignar el rol super_admin_global." },
          { status: 403 }
        );
      }

      data.role = role;
    }

    if (status) {
      data.status = status;

      if (status === "activo") {
        data.approvedAt = new Date();
        data.approvedByUserId = session.userId;
      } else {
        data.approvedAt = null;
        data.approvedByUserId = null;
      }
    }

    if (tenantId !== undefined) {
      if (session.role === "super_admin_cliente") {
        return NextResponse.json(
          { error: "No puedes reasignar usuarios entre tenants." },
          { status: 403 }
        );
      }

      const normalizedTenantId =
        tenantId === "" || tenantId === null ? null : Number(tenantId);

      if (
        normalizedTenantId !== null &&
        (!normalizedTenantId || Number.isNaN(normalizedTenantId))
      ) {
        return NextResponse.json(
          { error: "El tenant seleccionado no es válido." },
          { status: 400 }
        );
      }

      if (normalizedTenantId !== null) {
        const tenantExists = await prisma.tenant.findUnique({
          where: { id: normalizedTenantId },
          select: { id: true },
        });

        if (!tenantExists) {
          return NextResponse.json(
            { error: "El tenant seleccionado no existe." },
            { status: 400 }
          );
        }
      }

      data.tenantId = normalizedTenantId;
    }

    if (operatorMode !== undefined) {
      data.operatorMode = operatorMode || null;
    }

    if (dataSourceMode !== undefined) {
      data.dataSourceMode = dataSourceMode || null;
    }

    if (percentageRate !== undefined) {
      data.percentageRate =
        percentageRate === "" || percentageRate === null
          ? null
          : Number(percentageRate);
    }

    if (partnerSharePercent !== undefined) {
      data.partnerSharePercent =
        partnerSharePercent === "" || partnerSharePercent === null
          ? null
          : Number(partnerSharePercent);
    }

    if (typeof canManageOperators === "boolean") {
      data.canManageOperators = canManageOperators;
    }

    if (typeof canConnectOwnSheet === "boolean") {
      data.canConnectOwnSheet = canConnectOwnSheet;
    }

    const finalOperatorMode =
      data.operatorMode !== undefined ? data.operatorMode : undefined;
    const finalDataSourceMode =
      data.dataSourceMode !== undefined ? data.dataSourceMode : undefined;

    if (finalOperatorMode === "porcentaje") {
      data.partnerSharePercent = null;
    }

    if (finalOperatorMode === "socio") {
      data.percentageRate = null;
    }

    if (
      finalOperatorMode === "libre" ||
      finalOperatorMode === "proveedor" ||
      finalOperatorMode === "manual"
    ) {
      data.percentageRate = null;
      data.partnerSharePercent = null;
    }

    if (finalDataSourceMode === "base_onze") {
      data.canConnectOwnSheet = false;
    }

    if (finalDataSourceMode === "base_propia") {
      data.canConnectOwnSheet = true;
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
        tenantId: true,
        operatorMode: true,
        dataSourceMode: true,
        percentageRate: true,
        partnerSharePercent: true,
        canManageOperators: true,
        canConnectOwnSheet: true,
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
