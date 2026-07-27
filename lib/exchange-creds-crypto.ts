import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";

function getKey(): Buffer {
  const raw = process.env.EXCHANGE_CREDS_ENC_KEY;
  if (!raw) throw new Error("EXCHANGE_CREDS_ENC_KEY no definido en .env.local");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("EXCHANGE_CREDS_ENC_KEY debe ser una clave de 32 bytes en base64");
  return key;
}

// Cifra apiKey/secretKey/passphrase de Binance/Bybit/OKX antes de guardarlas en
// Neon. Reversible (no hash) porque el bot necesita el valor real para firmar
// cada llamada a la API del exchange. El prefijo "enc:" permite distinguir
// valores ya migrados de los que todavía están en texto plano (ver
// decryptExchangeSecret) durante la migración de datos existentes.
export function encryptExchangeSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

// Si el valor no tiene el prefijo "enc:" se asume texto plano no migrado
// todavía (fila vieja) y se devuelve tal cual, para no romper el bot mientras
// corre la migración de datos existentes.
export function decryptExchangeSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  const last4 = value.slice(-4);
  return "••••••••" + last4;
}
