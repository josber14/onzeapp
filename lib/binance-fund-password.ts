import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { prisma } from "@/lib/prisma";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.FUND_PASSWORD_ENC_KEY;
  if (!raw) throw new Error("FUND_PASSWORD_ENC_KEY no definido en .env.local");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("FUND_PASSWORD_ENC_KEY debe ser una clave de 32 bytes en base64");
  return key;
}

// Cifrado reversible (no hash) — a diferencia del PIN, Binance exige el
// valor REAL de la contraseña de fondos para cifrarlo de nuevo con su llave
// RSA en cada liberación, así que hay que poder recuperar el texto plano.
export function encryptFundPassword(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptFundPassword(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function setBinanceFundPassword(tenantId: number, label: string, password: string): Promise<void> {
  const fundPasswordEnc = encryptFundPassword(password);
  await prisma.binanceCredentials.update({
    where: { tenantId_label: { tenantId, label } },
    data: { fundPasswordEnc },
  });
}

export async function hasBinanceFundPassword(tenantId: number, label: string): Promise<boolean> {
  const creds = await prisma.binanceCredentials.findUnique({ where: { tenantId_label: { tenantId, label } } });
  return !!creds?.fundPasswordEnc;
}

export async function getBinanceFundPassword(tenantId: number, label: string): Promise<string | null> {
  const creds = await prisma.binanceCredentials.findUnique({ where: { tenantId_label: { tenantId, label } } });
  if (!creds?.fundPasswordEnc) return null;
  return decryptFundPassword(creds.fundPasswordEnc);
}
