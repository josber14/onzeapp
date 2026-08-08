import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";
import { verifyTotpForClient } from "@/lib/usdt-totp";
import { getClientAvailableUsdt, toClientWithdrawal } from "@/lib/usdt-purchase";
import { SkipoV2Client } from "@/lib/skipo-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ejecuta un retiro real. Decisión explícita del usuario (ago 2026): el
// cliente SOLO puede elegir entre direcciones que el admin ya precargó
// (UsdtWithdrawalAddress, ligadas a un contacto ya whitelisteado del lado
// del proveedor) -- nunca escribe una dirección nueva a mano.
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
  const addressId = Number(body.addressId);
  const amount = Number(body.amount);
  const code = String(body.code || "").trim();

  if (!addressId) return NextResponse.json({ ok: false, error: "Elige una dirección de destino" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ ok: false, error: "Ingresa un monto válido" }, { status: 400 });
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ ok: false, error: "Ingresa el código de 6 dígitos de tu 2FA" }, { status: 400 });

  // Defensa en profundidad -- la pantalla ya deshabilita "Revisar" bajo el
  // mínimo, pero el mínimo real (consultado en vivo a Skipo) también se
  // valida acá antes de intentar el retiro, no solo confiar en el front.
  try {
    const skipoInfo = new SkipoV2Client();
    const assetInfo = await skipoInfo.getAssetInfo("USDT");
    const minimumWithdrawal = Number(assetInfo.minimumWithdrawal);
    if (Number.isFinite(minimumWithdrawal) && amount < minimumWithdrawal) {
      return NextResponse.json({ ok: false, error: `El monto mínimo de retiro es ${minimumWithdrawal} USDT` }, { status: 400 });
    }
  } catch {
    // Si Skipo no responde acá, no bloqueamos el retiro solo por esto -- el
    // proveedor igual va a rechazarlo si de verdad está bajo su mínimo.
  }

  const validCode = await verifyTotpForClient(client.id, code);
  if (!validCode) return NextResponse.json({ ok: false, error: "Código de 2FA incorrecto" }, { status: 401 });

  const address = await prisma.usdtWithdrawalAddress.findUnique({ where: { id: addressId } });
  if (!address || address.clientId !== client.id || address.tenantId !== client.tenantId || !address.active) {
    return NextResponse.json({ ok: false, error: "Dirección no encontrada" }, { status: 404 });
  }

  // Evita que un doble click / reintento dispare dos retiros mientras uno
  // ya está en curso -- mismo espíritu que el claim atómico de la compra
  // (ver purchase-intent/[id]/execute/route.ts), simplificado porque acá no
  // hay un intent previo que reclamar.
  const alreadyPending = await prisma.usdtWithdrawal.findFirst({
    where: { clientId: client.id, tenantId: client.tenantId, status: "pending" },
  });
  if (alreadyPending) {
    return NextResponse.json({ ok: false, error: "Ya tienes un retiro en proceso, espera a que termine" }, { status: 409 });
  }

  const available = await getClientAvailableUsdt(client.tenantId, client.id);
  if (amount > available) {
    return NextResponse.json({ ok: false, error: `Superas tu saldo disponible (${available.toFixed(2)} USDT)` }, { status: 400 });
  }

  // Se reserva el monto ANTES de llamar al proveedor -- getClientAvailableUsdt
  // ya cuenta los retiros "pending", así que un segundo pedido concurrente ve
  // el saldo ya descontado (protege contra duplicar el gasto, no solo el
  // duplicado exacto de la misma llamada).
  const withdrawal = await prisma.usdtWithdrawal.create({
    data: {
      tenantId: client.tenantId,
      clientId: client.id,
      addressId: address.id,
      amountUsdt: amount,
      status: "pending",
    },
  });

  try {
    const skipoClient = new SkipoV2Client();
    const result = await skipoClient.createWithdrawal({
      asset: address.assetSymbol,
      amount: String(amount),
      contactId: address.providerContactId,
    });

    const rawStatus = String(result.status || "").toUpperCase();
    const mappedStatus = rawStatus === "COMPLETED" ? "completed" : rawStatus === "FAILED" || rawStatus === "REJECTED" || rawStatus === "CANCELLED" ? "failed" : "pending";

    const updated = await prisma.usdtWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        providerWithdrawalId: result.id,
        feeUsdt: result.fee ? Number(result.fee) : null,
        totalUsdt: result.total ? Number(result.total) : amount,
        status: mappedStatus,
        completedAt: mappedStatus === "completed" ? new Date() : null,
      },
    });

    return NextResponse.json({ ok: true, withdrawal: toClientWithdrawal(updated) });
  } catch (e: any) {
    // Nunca reenviar e.message al cliente -- ver mismo comentario en
    // quote/route.ts, el proveedor no debe quedar expuesto.
    console.error(`[UsdtWithdrawal ${withdrawal.id}] ${e.message}`);
    await prisma.usdtWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: "failed", errorMessage: e.message, totalUsdt: amount },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: "No se pudo procesar el retiro, contáctanos si el problema persiste" }, { status: 502 });
  }
}
