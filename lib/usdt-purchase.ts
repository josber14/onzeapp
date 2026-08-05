import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";

// Alfabeto sin 0/O/1/I — evita que el cliente confunda un carácter con otro
// al copiar el código a mano en el comentario/glosa de su transferencia.
const REFERENCE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REFERENCE_CODE_LENGTH = 6;

export function generateReferenceCode(): string {
  let code = "";
  for (let i = 0; i < REFERENCE_CODE_LENGTH; i++) {
    code += REFERENCE_CODE_ALPHABET[randomInt(REFERENCE_CODE_ALPHABET.length)];
  }
  return code;
}

// Busca un código de referencia válido dentro de un texto libre (ej. el
// comentario/glosa de una transferencia) — exige los 6 caracteres del
// alfabeto seguidos, como palabra completa, para no matchear por accidente
// un fragmento de otra palabra.
export function findReferenceCodeInText(text: string): string | null {
  if (!text) return null;
  const pattern = new RegExp(`\\b[${REFERENCE_CODE_ALPHABET}]{${REFERENCE_CODE_LENGTH}}\\b`, "i");
  const match = text.toUpperCase().match(pattern);
  return match ? match[0] : null;
}

// Pedido explícito del usuario (ago 2026): ningún cliente debe poder ver
// quién es el proveedor real (Skipo) detrás de sus compras/retiros -- ni
// siquiera el NOMBRE de un campo lo puede revelar. UsdtPurchaseIntent tiene
// skipoOrdId/skipoConvertId (identificadores internos del proveedor); un
// findMany/findUnique sin `select` los serializa tal cual en el JSON de
// respuesta, exponiendo la palabra "skipo" en la pestaña Network del
// navegador aunque el VALOR sea null. Toda ruta bajo /api/usdt-client/* que
// devuelva un UsdtPurchaseIntent al cliente debe pasarlo por acá primero.
export function toClientPurchaseIntent(intent: Record<string, any>) {
  const {
    id, tenantId: _tenantId, clientId: _clientId, referenceCode, requestedClp, receivedClp,
    status, usdtAmount, executedRate, createdAt, updatedAt, readyAt, executedAt,
  } = intent;
  return {
    id, referenceCode, requestedClp, receivedClp, status, usdtAmount, executedRate,
    createdAt, updatedAt, readyAt, executedAt,
  };
}

// Fuente única de verdad del saldo disponible de un cliente -- ANTES este
// número solo se calculaba en el navegador (billetera/page.tsx sumando
// compras) y nunca restaba los retiros, así que un cliente podía pedir
// retirar más de lo que en realidad tenía disponible. Server-side siempre:
// compras COMPLETADAS - retiros que ya comprometieron el saldo (pending +
// completed; "failed"/"error" nunca movieron nada, no restan).
export async function getClientAvailableUsdt(tenantId: number, clientId: number): Promise<number> {
  const [purchased, withdrawn] = await Promise.all([
    prisma.usdtPurchaseIntent.aggregate({
      where: { tenantId, clientId, status: "completed" },
      _sum: { usdtAmount: true },
    }),
    prisma.usdtWithdrawal.aggregate({
      where: { tenantId, clientId, status: { in: ["pending", "completed"] } },
      _sum: { totalUsdt: true },
    }),
  ]);
  const totalPurchased = Number(purchased._sum.usdtAmount || 0);
  const totalWithdrawn = Number(withdrawn._sum.totalUsdt || 0);
  return Math.max(totalPurchased - totalWithdrawn, 0);
}

// Mismo motivo que toClientPurchaseIntent -- providerWithdrawalId es el id
// interno del proveedor, nunca debe llegar al cliente.
export function toClientWithdrawal(w: Record<string, any>) {
  const {
    id, addressId, amountUsdt, feeUsdt, totalUsdt, status,
    createdAt, updatedAt, completedAt,
  } = w;
  return { id, addressId, amountUsdt, feeUsdt, totalUsdt, status, createdAt, updatedAt, completedAt };
}
