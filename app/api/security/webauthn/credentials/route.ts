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

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const rows = await prisma.p2PWebAuthnCredential.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, deviceLabel: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, credentials: rows });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const row = await prisma.p2PWebAuthnCredential.findUnique({ where: { id } });
  if (!row || row.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }
  await prisma.p2PWebAuthnCredential.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
