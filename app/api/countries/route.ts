import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const countries = await prisma.country.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        currencyCode: true,
        flagEmoji: true,
      },
    });

    return NextResponse.json({ countries });
  } catch (error) {
    console.error("GET /api/countries error:", error);
    return NextResponse.json(
      { error: "Error al obtener países" },
      { status: 500 }
    );
  }
}
