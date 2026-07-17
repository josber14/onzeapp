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
  const account = await prisma.partnerAccount.findUnique({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
  });
  return NextResponse.json({
    ok: true,
    value: account?.initialCapitalUsdt ? Number(account.initialCapitalUsdt) : 0,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const value = Number(body?.value);
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json({ ok: false, error: "Valor inválido" }, { status: 400 });
  }

  const existing = await prisma.partnerAccount.findUnique({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Primero conecta la cuenta del socio" }, { status: 400 });
  }
  await prisma.partnerAccount.update({
    where: { id: existing.id },
    data: { initialCapitalUsdt: value },
  });
  return NextResponse.json({ ok: true, value });
}
