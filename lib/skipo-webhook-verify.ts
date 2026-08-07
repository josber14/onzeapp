import { createPublicKey, verify as cryptoVerify, type KeyObject } from "crypto";

// Verificación de la firma JWS detached (EdDSA/Ed25519) de los webhooks de
// Skipo -- ver https://docs.skipo.com/concepts/webhooks. SIEMPRE se verifica
// contra los bytes CRUDOS del body, nunca contra una reserialización del
// JSON ya parseado (reserializar invalida la firma).

const JWKS_URL = "https://api.skipo.com/v2/.well-known/webhook-jwks.json";
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
// Skipo firma el timestamp dentro de la firma (protegido contra manipulación)
// -- rechazar cualquier desvío mayor a esto protege contra ataques de replay
// (reenviar un webhook viejo capturado).
const MAX_TIMESTAMP_SKEW_SEC = 300;

let jwksCache: { fetchedAt: number; keys: Map<string, JsonWebKey> } | null = null;

async function fetchJwks(forceRefresh = false): Promise<Map<string, JsonWebKey>> {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`No se pudo obtener el JWKS de Skipo: HTTP ${res.status}`);
  const data = await res.json();
  const keys = new Map<string, JsonWebKey>();
  for (const jwk of data.keys || []) {
    if (jwk.kid) keys.set(jwk.kid, jwk);
  }
  jwksCache = { fetchedAt: Date.now(), keys };
  return keys;
}

async function getPublicKeyForKid(kid: string): Promise<KeyObject | null> {
  let keys = await fetchJwks();
  let jwk = keys.get(kid);
  if (!jwk) {
    // La llave puede haber rotado del lado de Skipo -- refresca el cache
    // UNA vez antes de rendirse, nunca confía en una llave que no está en
    // el JWKS real.
    keys = await fetchJwks(true);
    jwk = keys.get(kid);
  }
  if (!jwk) return null;
  // Node tipa createPublicKey({key, format:"jwk"}) de forma demasiado
  // estricta para un JWK leído dinámicamente de una URL -- la forma en
  // tiempo de ejecución es correcta (confirmada contra el JWKS real de
  // Skipo), el "as any" es solo para esa discrepancia de tipos.
  return createPublicKey({ key: jwk, format: "jwk" } as any);
}

export interface SkipoWebhookVerifyResult {
  valid: boolean;
  reason?: string;
}

export async function verifySkipoWebhookSignature(
  signatureHeader: string,
  rawBody: Buffer
): Promise<SkipoWebhookVerifyResult> {
  const parts = signatureHeader.split(".");
  if (parts.length !== 3) return { valid: false, reason: "formato de firma inválido" };
  const [protectedB64, emptyPayload, signatureB64] = parts;
  // Formato JWS compact con payload "detached" -- el segmento del medio
  // debe venir vacío; el payload real es el body crudo, sustituido a mano
  // al reconstruir lo que se firmó (ver más abajo).
  if (emptyPayload !== "") return { valid: false, reason: "formato de firma inválido (payload no vacío)" };

  let protectedHeader: any;
  try {
    protectedHeader = JSON.parse(Buffer.from(protectedB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "header protegido inválido" };
  }

  if (protectedHeader.alg !== "EdDSA") {
    return { valid: false, reason: `algoritmo no soportado: ${protectedHeader.alg}` };
  }
  const kid = protectedHeader.kid;
  if (!kid || typeof kid !== "string") return { valid: false, reason: "falta kid en el header" };

  const iat = protectedHeader["skipo.io/iat"];
  if (typeof iat !== "number") return { valid: false, reason: "falta skipo.io/iat en el header" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - iat) > MAX_TIMESTAMP_SKEW_SEC) {
    return { valid: false, reason: `timestamp fuera de rango (posible replay): iat=${iat}, ahora=${nowSec}` };
  }

  let publicKey: KeyObject | null;
  try {
    publicKey = await getPublicKeyForKid(kid);
  } catch (e: any) {
    return { valid: false, reason: `no se pudo obtener el JWKS: ${e.message}` };
  }
  if (!publicKey) return { valid: false, reason: `llave pública desconocida (kid=${kid})` };

  // Input firmado real: "<protected-b64>.<base64url(rawBody)>" -- NUNCA se
  // reconstruye a partir del JSON parseado, siempre de los bytes crudos tal
  // como llegaron.
  const signingInput = Buffer.from(
    `${protectedB64}.${rawBody.toString("base64url")}`,
    "utf8"
  );
  const signature = Buffer.from(signatureB64, "base64url");

  // Ed25519: el primer argumento (algoritmo de digest) debe ser null -- el
  // propio algoritmo ya incluye su hashing interno.
  const ok = cryptoVerify(null, signingInput, publicKey, signature);
  return ok ? { valid: true } : { valid: false, reason: "firma inválida" };
}
