import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  if (session.role !== "super_admin_global" && session.role !== "super_admin_cliente") {
    return { error: NextResponse.json({ error: "No tienes permisos." }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const tiers = await prisma.usdtMarginTier.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { minClp: "asc" },
  });
  return NextResponse.json({
    ok: true,
    tiers: tiers.map((t) => ({
      id: t.id, minClp: Number(t.minClp), maxClp: t.maxClp ? Number(t.maxClp) : null, marginPct: Number(t.marginPct),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const minClp = Number(body.minClp);
  const maxClp = body.maxClp === null || body.maxClp === undefined || body.maxClp === "" ? null : Number(body.maxClp);
  const marginPct = Number(body.marginPct);

  if (!(minClp >= 0)) return NextResponse.json({ error: "minClp inválido" }, { status: 400 });
  if (maxClp !== null && maxClp <= minClp) return NextResponse.json({ error: "maxClp debe ser mayor que minClp" }, { status: 400 });
  if (!(marginPct >= 0)) return NextResponse.json({ error: "marginPct inválido" }, { status: 400 });

  const tier = await prisma.usdtMarginTier.create({
    data: { tenantId: session.tenantId, minClp, maxClp, marginPct },
  });
  return NextResponse.json({ ok: true, tier: { ...tier, minClp: Number(tier.minClp), maxClp: tier.maxClp ? Number(tier.maxClp) : null, marginPct: Number(tier.marginPct) } });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const existing = await prisma.usdtMarginTier.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const minClp = Number(body.minClp);
  const maxClp = body.maxClp === null || body.maxClp === undefined || body.maxClp === "" ? null : Number(body.maxClp);
  const marginPct = Number(body.marginPct);

  if (!(minClp >= 0)) return NextResponse.json({ error: "minClp inválido" }, { status: 400 });
  if (maxClp !== null && maxClp <= minClp) return NextResponse.json({ error: "maxClp debe ser mayor que minClp" }, { status: 400 });
  if (!(marginPct >= 0)) return NextResponse.json({ error: "marginPct inválido" }, { status: 400 });

  const tier = await prisma.usdtMarginTier.update({ where: { id }, data: { minClp, maxClp, marginPct } });
  return NextResponse.json({ ok: true, tier: { ...tier, minClp: Number(tier.minClp), maxClp: tier.maxClp ? Number(tier.maxClp) : null, marginPct: Number(tier.marginPct) } });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const tier = await prisma.usdtMarginTier.findUnique({ where: { id } });
  if (!tier || tier.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  await prisma.usdtMarginTier.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
