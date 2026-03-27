import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Correo inválido." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    const genericMessage =
      "Si el correo existe, te enviaremos un código para restablecer tu contraseña.";

    if (!user) {
      return NextResponse.json({ ok: true, message: genericMessage });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetCode.create({
      data: {
        email: normalizedEmail,
        code,
        expiresAt,
      },
    });

    console.log("Código de recuperación ONZE:", {
      email: normalizedEmail,
      code,
      expiresAt,
    });

    return NextResponse.json({
      ok: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "No se pudo procesar la solicitud." },
      { status: 500 }
    );
  }
}
