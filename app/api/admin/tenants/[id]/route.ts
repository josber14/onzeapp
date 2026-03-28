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

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);

  if (!session) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  if (
    session.role !== "super_admin_global" &&
    session.role !== "super_admin_cliente"
  ) {
    return {
      error: NextResponse.json(
        { error: "No tienes permisos para gestionar tenants." },
        { status: 403 }
      ),
    };
  }

  return { session };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await context.params;
    const tenantId = Number(id);

    if (!tenantId || Number.isNaN(tenantId)) {
      return NextResponse.json(
        { error: "ID de tenant inválido." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      code,
      tradeName,
      legalName,
      ownerUserId,
      dataSourceMode,
      isOnzeInternal,
      active,
    } = body;

    const data: {
      code?: string;
      tradeName?: string;
      legalName?: string | null;
      ownerUserId?: number | null;
      dataSourceMode?: "base_onze" | "base_propia";
      isOnzeInternal?: boolean;
      active?: boolean;
    } = {};

    if (code !== undefined) {
      if (!code || typeof code !== "string") {
        return NextResponse.json(
          { error: "El código del tenant es inválido." },
          { status: 400 }
        );
      }

      data.code = code.trim().toLowerCase();
    }

    if (tradeName !== undefined) {
      if (!tradeName || typeof tradeName !== "string") {
        return NextResponse.json(
          { error: "El nombre comercial es inválido." },
          { status: 400 }
        );
      }

      data.tradeName = tradeName.trim();
    }

    if (legalName !== undefined) {
      data.legalName =
        typeof legalName === "string" && legalName.trim() ? legalName.trim() : null;
    }

    if (ownerUserId !== undefined) {
      data.ownerUserId =
        ownerUserId === "" || ownerUserId === null ? null : Number(ownerUserId);

      if (
        data.ownerUserId !== null &&
        (!data.ownerUserId || Number.isNaN(data.ownerUserId))
      ) {
        return NextResponse.json(
          { error: "El ownerUserId no es válido." },
          { status: 400 }
        );
      }
    }

    if (dataSourceMode !== undefined) {
      if (dataSourceMode !== "base_onze" && dataSourceMode !== "base_propia") {
        return NextResponse.json(
          { error: "La fuente de datos no es válida." },
          { status: 400 }
        );
      }

      data.dataSourceMode = dataSourceMode;
    }

    if (typeof isOnzeInternal === "boolean") {
      data.isOnzeInternal = isOnzeInternal;
    }

    if (typeof active === "boolean") {
      data.active = active;
    }

    if (data.code) {
      const existingTenant = await prisma.tenant.findFirst({
        where: {
          code: data.code,
          NOT: {
            id: tenantId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingTenant) {
        return NextResponse.json(
          { error: "Ya existe otro tenant con ese código." },
          { status: 400 }
        );
      }
    }

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: {
        id: true,
        code: true,
        legalName: true,
        tradeName: true,
        ownerUserId: true,
        dataSourceMode: true,
        isOnzeInternal: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, tenant });
  } catch (error) {
    console.error("ADMIN_TENANT_PATCH_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo actualizar el tenant." },
      { status: 500 }
    );
  }
}
