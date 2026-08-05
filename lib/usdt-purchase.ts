import { randomInt } from "crypto";

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
