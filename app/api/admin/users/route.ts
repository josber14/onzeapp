import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
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
    });

    return NextResponse.json({ ok: true, users });
  } catch (error) {
    console.error("ADMIN_USERS_GET_ERROR", error);

    return NextResponse.json(
      { error: "No se pudieron cargar los usuarios." },
      { status: 500 }
    );
  }
}