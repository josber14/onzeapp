import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Espejo de /api/partner/ppm-config pero para el Capital P2P propio de ONZE
// -- guardado directo en Tenant.p2pPpmPct (una sola bolsa por tenant).
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  return NextResponse.json({
    ok: true,
    value: tenant?.p2pPpmPct !== null && tenant?.p2pPpmPct !== undefined ? Number(tenant.p2pPpmPct) : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const value = Number(body?.value);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return NextResponse.json({ ok: false, error: "Porcentaje inválido (0-100)" }, { status: 400 });
  }
  await prisma.tenant.update({
    where: { id: session.tenantId },
    data: { p2pPpmPct: value },
  });
  return NextResponse.json({ ok: true, value });
}
