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
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  const session = verifySessionToken(token);
  if (!session || session.role !== "super_admin_global") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get("days")) || 1, 1), 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.countryRateHistory.findMany({
    where: { recordedAt: { gte: since } },
    orderBy: [{ country: "asc" }, { recordedAt: "desc" }],
  });

  return NextResponse.json({ ok: true, rows });
}
