import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Mismo patrón que app/api/auth/reset-password (paneles de operador),
// aplicado a UsdtClient (tenantId + email) en vez de User.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const newPassword = String(body.newPassword || "");
    const tenantId = Number(body.tenantId) || 1;

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "La nueva contraseña debe tener al menos 6 caracteres." }, { status: 400 });
    }

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        email,
        code,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetCode) {
      return NextResponse.json({ error: "El código es inválido o venció." }, { status: 400 });
    }

    const client = await prisma.usdtClient.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });

    if (!client) {
      return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.usdtClient.update({
      where: { id: client.id },
      data: { passwordHash },
    });

    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { usedAt: new Date() },
    });

    return NextResponse.json({ ok: true, message: "Contraseña actualizada correctamente. Ya puedes iniciar sesión." });
  } catch (error) {
    console.error("Reset password (usdt-client) error:", error);
    return NextResponse.json({ error: "No se pudo restablecer la contraseña." }, { status: 500 });
  }
}
