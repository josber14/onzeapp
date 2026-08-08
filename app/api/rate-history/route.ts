import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historial de tasa de compra/venta por país -- pedido explícito del usuario
// (ago 2026): visible SOLO para super_admin_global, nadie más (ni operador
// ni super_admin_cliente).
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session || session.role !== "super_admin_global") {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date"); // "YYYY-MM-DD", hora de Chile (UTC-4 fijo, igual que el resto del proyecto)

    let where: any;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const dayStart = new Date(`${dateParam}T00:00:00.000-04:00`);
      const dayEnd = new Date(`${dateParam}T23:59:59.999-04:00`);
      where = { recordedAt: { gte: dayStart, lte: dayEnd } };
    } else {
      const days = Math.min(Math.max(Number(searchParams.get("days")) || 1, 1), 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      where = { recordedAt: { gte: since } };
    }

    const rows = await prisma.countryRateHistory.findMany({
      where,
      orderBy: [{ country: "asc" }, { recordedAt: "desc" }],
    });

    return NextResponse.json({ ok: true, rows });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
