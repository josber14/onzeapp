import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const items = await prisma.partnerCapacity.findMany({
    where: { tenantId: session.tenantId, label: LABEL },
    orderBy: { id: "asc" },
  });
  const normalized = items.map((it) => ({
    id: it.id,
    provider: it.provider,
    capacityClp: Number(it.capacityClp),
    buyPrice: Number(it.buyPrice),
    usdtAmount: Number(it.usdtAmount),
    date: it.date,
    status: it.status,
    finishedAt: it.finishedAt ? it.finishedAt.toISOString() : null,
    createdAt: it.createdAt.toISOString(),
  }));
  return NextResponse.json({ ok: true, items: normalized });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const item = body?.item;
  if (!item?.id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const data = {
    tenantId: session.tenantId,
    label: LABEL,
    provider: String(item.provider || ""),
    capacityClp: Number(item.capacityClp || 0),
    buyPrice: Number(item.buyPrice || 0),
    usdtAmount: Number(item.usdtAmount || 0),
    date: String(item.date || ""),
    status: String(item.status || "active"),
    finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
  };
  await prisma.partnerCapacity.upsert({
    where: { id: String(item.id) },
    update: data,
    create: { id: String(item.id), ...data },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const confirmDelete = searchParams.get("confirm");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  if (confirmDelete !== "manual") {
    return NextResponse.json(
      { ok: false, error: "DELETE bloqueado: falta confirmación manual" },
      { status: 409 }
    );
  }
  await prisma.partnerCapacity.deleteMany({
    where: { id, tenantId: session.tenantId, label: LABEL },
  });
  return NextResponse.json({ ok: true });
}
