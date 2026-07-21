import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.TOTP_SECRET_ENC_KEY;
  if (!raw) throw new Error("TOTP_SECRET_ENC_KEY no definido en .env.local");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOTP_SECRET_ENC_KEY debe ser una clave de 32 bytes en base64");
  return key;
}

// Cifrado reversible (no hash) — hace falta el secreto real en cada
// verificación de código, a diferencia del PIN que solo compara un hash.
function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecret(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// Genera un secreto nuevo y lo guarda cifrado como "pendiente" (totpEnabled
// sigue en false) — no se activa hasta que el cliente confirme un código
// real generado por su app de autenticación, en usdt-totp confirmSetup.
export async function beginTotpSetup(clientId: number, email: string): Promise<{ secret: string; qrDataUrl: string }> {
  const secret = generateSecret();
  const uri = generateURI({ issuer: "ONZE ZINPLE", label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(uri);

  await prisma.usdtClient.update({
    where: { id: clientId },
    data: { totpSecretEnc: encryptSecret(secret), totpEnabled: false },
  });

  return { secret, qrDataUrl };
}

export async function confirmTotpSetup(clientId: number, token: string): Promise<{ ok: boolean; error?: string }> {
  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client?.totpSecretEnc) return { ok: false, error: "No hay una configuración de 2FA pendiente" };

  const secret = decryptSecret(client.totpSecretEnc);
  const result = await verify({ secret, token });
  if (!result.valid) return { ok: false, error: "Código incorrecto" };

  await prisma.usdtClient.update({ where: { id: clientId }, data: { totpEnabled: true } });
  return { ok: true };
}

export async function verifyTotpForClient(clientId: number, token: string): Promise<boolean> {
  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client?.totpEnabled || !client.totpSecretEnc) return false;
  const secret = decryptSecret(client.totpSecretEnc);
  const result = await verify({ secret, token });
  return result.valid;
}

export async function disableTotp(clientId: number, token: string): Promise<{ ok: boolean; error?: string }> {
  const valid = await verifyTotpForClient(clientId, token);
  if (!valid) return { ok: false, error: "Código incorrecto" };
  await prisma.usdtClient.update({ where: { id: clientId }, data: { totpSecretEnc: null, totpEnabled: false } });
  return { ok: true };
}
