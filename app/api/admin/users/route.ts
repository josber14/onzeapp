import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
        { error: "No tienes permisos para ver usuarios." },
        { status: 403 }
      );
    }

    const userWhere =
      session.role === "super_admin_global"
        ? {}
        : {
            tenantId: session.tenantId,
          };

    const tenantWhere =
      session.role === "super_admin_global"
        ? { active: true }
        : {
            id: session.tenantId ?? -1,
            active: true,
          };

    const [users, tenants] = await Promise.all([
      prisma.user.findMany({
        where: userWhere,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          residenceCountryCode: true,
          role: true,
          status: true,
          tenantId: true,
          operatorMode: true,
          dataSourceMode: true,
          percentageRate: true,
          partnerSharePercent: true,
          canManageOperators: true,
          canConnectOwnSheet: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              tradeName: true,
              code: true,
              active: true,
            },
          },
        },
      }),
      prisma.tenant.findMany({
        where: tenantWhere,
        orderBy: {
          tradeName: "asc",
        },
        select: {
          id: true,
          tradeName: true,
          code: true,
          active: true,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, users, tenants });
  } catch (error) {
    console.error("ADMIN_USERS_GET_ERROR", error);

    return NextResponse.json(
      { error: "No se pudieron cargar los usuarios." },
      { status: 500 }
    );
  }
}
