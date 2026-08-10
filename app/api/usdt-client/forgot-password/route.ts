import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getResendClient } from "@/lib/resend";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Mismo patrón que app/api/auth/forgot-password (paneles de operador),
// reusando la misma tabla PasswordResetCode -- el código solo distingue por
// email al restablecer, y este flujo busca en UsdtClient en vez de User.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const tenantId = Number(body.tenantId) || 1;

    if (!email) {
      return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
    }

    const client = await prisma.usdtClient.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true, email: true, fullName: true },
    });

    const genericMessage = "Si el correo existe, te enviaremos un código para restablecer tu contraseña.";

    if (!client) {
      return NextResponse.json({ ok: true, message: genericMessage });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetCode.create({
      data: { email, code, expiresAt },
    });

    const resend = getResendClient();

    const { error } = await resend.emails.send({
      from: "ONZE <soporte@onze-pay.com>",
      to: email,
      subject: "Tu código de recuperación de ONZE",
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.6;">
          <h2 style="margin-bottom: 8px;">Recuperación de contraseña</h2>
          <p>Hola${client.fullName ? `, ${client.fullName}` : ""}.</p>
          <p>Tu código para restablecer la contraseña de tu cuenta ONZE es:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 20px 0; color: #15803d;">
            ${code}
          </div>
          <p>Este código vence en 15 minutos.</p>
          <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
        </div>
      `,
      text: `Tu código de recuperación de ONZE es: ${code}. Este código vence en 15 minutos.`,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: "No se pudo enviar el correo de recuperación." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: genericMessage });
  } catch (error) {
    console.error("Forgot password (usdt-client) error:", error);
    return NextResponse.json({ error: "No se pudo procesar la solicitud." }, { status: 500 });
  }
}
