import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { verifyTotpForClient } from "@/lib/usdt-totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Valida todo lo que ya podemos validar (sesión, 2FA, monto, dirección) —
// la ejecución real contra Skipo todavía no está conectada porque falta el
// registro de qué USDT le corresponde a cada cliente (depende de que el
// flujo de Comprar quede activo primero) y confirmar en vivo cómo Skipo
// espera la dirección de destino (registro de "contacto" antes de retirar).
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (client.status !== "approved") {
    return NextResponse.json({ ok: false, error: "Tu cuenta no está aprobada todavía" }, { status: 403 });
  }
  if (!client.totpEnabled) {
    return NextResponse.json({ ok: false, error: "Configura tu 2FA antes de retirar" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const address = String(body.address || "").trim();
  const network = String(body.network || "").trim();
  const code = String(body.code || "").trim();

  if (!(amount > 0)) return NextResponse.json({ ok: false, error: "Ingresa un monto válido" }, { status: 400 });
  if (!address) return NextResponse.json({ ok: false, error: "Ingresa la dirección de destino" }, { status: 400 });
  if (!["TRC20", "ERC20", "BEP20"].includes(network)) {
    return NextResponse.json({ ok: false, error: "Selecciona el protocolo de retiro (TRC20, ERC20 o BEP20)" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ ok: false, error: "Ingresa el código de 6 dígitos de tu 2FA" }, { status: 400 });

  const validCode = await verifyTotpForClient(client.id, code);
  if (!validCode) return NextResponse.json({ ok: false, error: "Código de 2FA incorrecto" }, { status: 401 });

  return NextResponse.json(
    { ok: false, error: "El retiro todavía no está disponible — estamos terminando de conectar el sistema de compras y retiros." },
    { status: 501 }
  );
}
