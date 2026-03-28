import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { session } = auth;

    const tenantWhere =
      session.role === "super_admin_global"
        ? {}
        : {
            id: session.tenantId ?? -1,
          };

    const userWhere =
      session.role === "super_admin_global"
        ? {
            status: "activo" as const,
          }
        : {
            status: "activo" as const,
            tenantId: session.tenantId,
          };

    const [tenants, users] = await Promise.all([
      prisma.tenant.findMany({
        where: tenantWhere,
        orderBy: {
          createdAt: "desc",
        },
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
          ownerUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          _count: {
            select: {
              users: true,
              customers: true,
              operations: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where: userWhere,
        orderBy: {
          fullName: "asc",
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          tenantId: true,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, tenants, users });
  } catch (error) {
    console.error("ADMIN_TENANTS_GET_ERROR", error);

    return NextResponse.json(
      { error: "No se pudieron cargar los tenants." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { session } = auth;

    if (session.role !== "super_admin_global") {
      return NextResponse.json(
        { error: "Solo el super admin global puede crear tenants." },
        { status: 403 }
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

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "El código del tenant es obligatorio." },
        { status: 400 }
      );
    }

    if (!tradeName || typeof tradeName !== "string") {
      return NextResponse.json(
        { error: "El nombre comercial es obligatorio." },
        { status: 400 }
      );
    }

    if (
      dataSourceMode !== "base_onze" &&
      dataSourceMode !== "base_propia"
    ) {
      return NextResponse.json(
        { error: "La fuente de datos no es válida." },
        { status: 400 }
      );
    }

    const normalizedCode = code.trim().toLowerCase();
    const normalizedTradeName = tradeName.trim();
    const normalizedLegalName =
      typeof legalName === "string" && legalName.trim() ? legalName.trim() : null;
    const normalizedOwnerUserId =
      ownerUserId === "" || ownerUserId === null || ownerUserId === undefined
        ? null
        : Number(ownerUserId);

    if (
      normalizedOwnerUserId !== null &&
      (!normalizedOwnerUserId || Number.isNaN(normalizedOwnerUserId))
    ) {
      return NextResponse.json(
        { error: "El usuario owner no es válido." },
        { status: 400 }
      );
    }

    const existingTenant = await prisma.tenant.findUnique({
      where: { code: normalizedCode },
      select: { id: true },
    });

    if (existingTenant) {
      return NextResponse.json(
        { error: "Ya existe un tenant con ese código." },
        { status: 400 }
      );
    }

    const tenant = await prisma.tenant.create({
      data: {
        code: normalizedCode,
        tradeName: normalizedTradeName,
        legalName: normalizedLegalName,
        ownerUserId: normalizedOwnerUserId,
        dataSourceMode,
        isOnzeInternal: Boolean(isOnzeInternal),
        active: typeof active === "boolean" ? active : true,
      },
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
    console.error("ADMIN_TENANTS_POST_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo crear el tenant." },
      { status: 500 }
    );
  }
}
