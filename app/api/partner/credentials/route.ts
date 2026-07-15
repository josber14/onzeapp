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

// Nunca devuelve apiKey/secretKey en crudo — solo si existe una cuenta configurada.
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const account = await prisma.partnerAccount.findUnique({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
  });
  return NextResponse.json({
    ok: true,
    exists: !!account,
    name: account?.name ?? null,
    isActive: account?.isActive ?? false,
    lastSyncedAt: account?.lastSyncedAt ? account.lastSyncedAt.toISOString() : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const apiKey = String(body?.apiKey || "").trim();
  const secretKey = String(body?.secretKey || "").trim();
  const name = body?.name ? String(body.name).trim() : null;
  if (!apiKey || !secretKey) {
    return NextResponse.json({ ok: false, error: "Falta apiKey o secretKey" }, { status: 400 });
  }
  await prisma.partnerAccount.upsert({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
    update: { apiKey, secretKey, name, isActive: true },
    create: { tenantId: session.tenantId, label: LABEL, apiKey, secretKey, name, isActive: true },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  await prisma.partnerAccount.deleteMany({
    where: { tenantId: session.tenantId, label: LABEL },
  });
  return NextResponse.json({ ok: true });
}
