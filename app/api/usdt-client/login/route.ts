import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const tenantId = Number(body.tenantId);

    if (!tenantId || !email || !password) {
      return NextResponse.json({ ok: false, error: "Correo y contraseña son obligatorios" }, { status: 400 });
    }

    const client = await prisma.usdtClient.findUnique({ where: { tenantId_email: { tenantId, email } } });
    if (!client) {
      return NextResponse.json({ ok: false, error: "Credenciales inválidas" }, { status: 401 });
    }

    const passwordOk = await bcrypt.compare(password, client.passwordHash);
    if (!passwordOk) {
      return NextResponse.json({ ok: false, error: "Credenciales inválidas" }, { status: 401 });
    }

    if (client.status !== "approved") {
      const statusMessages: Record<string, string> = {
        pending_kyc: "Tu registro todavía no está completo — falta enviar tu verificación de identidad.",
        pending_approval: "Tu cuenta está en revisión. Te avisaremos cuando esté aprobada.",
        rejected: "Tu solicitud fue rechazada. Contacta soporte para más información.",
        suspended: "Tu cuenta está suspendida. Contacta soporte para más información.",
      };
      return NextResponse.json(
        { ok: false, error: statusMessages[client.status] || "Tu cuenta no está activa", status: client.status },
        { status: 403 }
      );
    }

    const token = createUsdtClientSessionToken({
      clientId: client.id,
      tenantId: client.tenantId,
      email: client.email,
      fullName: client.fullName,
    });

    const response = NextResponse.json({
      ok: true,
      client: { id: client.id, email: client.email, fullName: client.fullName },
    });
    response.cookies.set(USDT_CLIENT_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
