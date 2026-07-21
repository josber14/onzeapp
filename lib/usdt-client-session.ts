// Sesión 100% separada del panel ONZE (onze_session/lib/session.ts) — cookie,
// secreto de firma y tabla de datos (UsdtClient) propios. Un cliente que
// compra USDT nunca debe poder acceder a nada del panel admin, y viceversa —
// por eso NO se reutiliza ningún código de sesión existente, aunque el
// patrón de firma HMAC sea el mismo.
import { createHmac, timingSafeEqual } from "crypto";

export type UsdtClientSessionPayload = {
  clientId: number;
  tenantId: number;
  email: string;
  fullName: string;
  exp: number;
};

export const USDT_CLIENT_SESSION_COOKIE = "usdt_client_session";

const USDT_CLIENT_SESSION_SECRET: string =
  process.env.USDT_CLIENT_SESSION_SECRET ??
  (() => {
    throw new Error("USDT_CLIENT_SESSION_SECRET no definido en .env.local");
  })();

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(base64, "base64").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", USDT_CLIENT_SESSION_SECRET).update(value).digest("hex");
}

export function createUsdtClientSessionToken(data: {
  clientId: number;
  tenantId: number;
  email: string;
  fullName: string;
}) {
  const payload: UsdtClientSessionPayload = {
    ...data,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyUsdtClientSessionToken(token?: string | null): UsdtClientSessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = sign(encodedPayload);

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as UsdtClientSessionPayload;
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
