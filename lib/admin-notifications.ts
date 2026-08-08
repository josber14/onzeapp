import { prisma } from "@/lib/prisma";
import { SkipoClient } from "@/lib/skipo-adapter";
import { findMarginPct } from "@/lib/usdt-margin";

// Notificaciones para el admin sobre actividad de compra USDT -- pedido
// explícito del usuario (ago 2026). Nunca bloquea el flujo real del cliente
// (se llama sin await/fire-and-forget desde las rutas que crean/cancelan
// una solicitud) -- si falla, el cliente no debe notarlo.

// skipoClpNeeded es lo que el admin debe mandar a Skipo para cubrir esta
// compra -- DISTINTO de requestedClp porque el cliente paga a la tasa CON
// margen (más cara) y el admin compra el USDT en Skipo a la tasa SIN margen
// (más barata). Ej: cliente pide $400.000 a 918 CLP/USDT (recibe 435.73
// USDT); si Skipo cobra 914 CLP/USDT, el admin solo necesita mandar a Skipo
// 435.73 * 914 ≈ $398.257, no los $400.000 completos.
export async function notifyPurchaseRequested(params: {
  tenantId: number;
  clientName: string;
  purchaseIntentId: number;
  requestedClp: number;
  fixedMarginPct: number | null;
}) {
  const { tenantId, clientName, purchaseIntentId, requestedClp, fixedMarginPct } = params;
  let skipoClpNeeded: number | null = null;
  try {
    const marginPct = fixedMarginPct !== null ? fixedMarginPct : await findMarginPct(tenantId, requestedClp);
    const skipoClient = new SkipoClient();
    const skipoQuote = await skipoClient.getQuotation({
      baseCurrencyId: "USDT",
      quoteCurrencyId: "CLP",
      qtyCurrencyId: "CLP",
      side: "BUY",
      quantity: String(requestedClp),
    });
    const skipoRate = Number(skipoQuote.rate);
    const clientRate = skipoRate * (1 + marginPct / 100);
    const usdtAmount = requestedClp / clientRate;
    skipoClpNeeded = usdtAmount * skipoRate;
  } catch {
    // Sin el monto a Skipo la notificación igual sirve -- mejor avisar sin
    // ese dato que no avisar nada.
  }

  await prisma.adminNotification.create({
    data: { tenantId, type: "purchase_requested", clientName, requestedClp, skipoClpNeeded, purchaseIntentId },
  }).catch(() => {});
}

export async function notifyPurchaseCancelled(params: {
  tenantId: number;
  clientName: string;
  purchaseIntentId: number;
  requestedClp: number;
}) {
  const { tenantId, clientName, purchaseIntentId, requestedClp } = params;
  await prisma.adminNotification.create({
    data: { tenantId, type: "purchase_cancelled", clientName, requestedClp, purchaseIntentId },
  }).catch(() => {});
}

// El cliente guardó/cambió su wallet de retiro en su perfil -- avisa al
// admin para que la agregue como contacto en Skipo sin tener que pedírsela
// por WhatsApp. Solo se llama cuando la dirección realmente cambió (ver
// profile/route.ts) -- no en cada guardado del perfil.
export async function notifyWalletAdded(params: {
  tenantId: number;
  clientName: string;
  walletAddress: string;
  withdrawalNetwork: string | null;
}) {
  const { tenantId, clientName, walletAddress, withdrawalNetwork } = params;
  await prisma.adminNotification.create({
    data: { tenantId, type: "wallet_added", clientName, walletAddress, withdrawalNetwork },
  }).catch(() => {});
}
