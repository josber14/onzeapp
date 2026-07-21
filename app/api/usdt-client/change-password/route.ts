import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "La nueva contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }

  const matches = await bcrypt.compare(currentPassword, client.passwordHash);
  if (!matches) {
    return NextResponse.json({ ok: false, error: "La contraseña actual es incorrecta" }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.usdtClient.update({ where: { id: client.id }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
}
