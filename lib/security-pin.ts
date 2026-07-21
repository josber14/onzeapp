import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 min — mismo patrón de cooldown que ya usa el bot para Binance
const TOKEN_TTL_MS = 2 * 60 * 1000; // 2 min de validez para el token de liberación

// orderNumber "de mentira" usado para autorizar cambios a la CONFIGURACIÓN de
// seguridad (cambiar el PIN, agregar una huella nueva) en vez de liberar una
// orden real — reutiliza la misma tabla/mecanismo de token de un solo uso.
export const SECURITY_SETTINGS_SCOPE = "__security_settings__";

export async function hasAnyWebAuthnCredential(tenantId: number): Promise<boolean> {
  const count = await prisma.p2PWebAuthnCredential.count({ where: { tenantId } });
  return count > 0;
}

// Si ya hay una huella registrada, cambiar el PIN o registrar una huella
// ADICIONAL exige verificar con una huella existente primero — si no, cualquiera
// con la sesión del panel abierta (sin saber el PIN ni tener el dedo del dueño)
// podría tomar el control de la protección. La primera huella/PIN (nada
// configurado todavía) se puede crear libremente — no hay nada que proteger aún.
export async function requireSettingsAuthIfConfigured(tenantId: number, token: string | undefined): Promise<{ ok: boolean; error?: string }> {
  const hasCredential = await hasAnyWebAuthnCredential(tenantId);
  if (!hasCredential) return { ok: true };
  const authorized = await consumeReleaseAuthToken(tenantId, SECURITY_SETTINGS_SCOPE, token || "");
  if (!authorized) {
    return { ok: false, error: "Verifica tu huella para confirmar este cambio" };
  }
  return { ok: true };
}

export async function setReleasePin(tenantId: number, pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "La clave debe ser exactamente 4 dígitos" };
  }
  const releasePinHash = await bcrypt.hash(pin, 10);
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: { releasePinHash, releasePinFailedAttempts: 0, releasePinLockedUntil: null },
    create: { tenantId, releasePinHash },
  });
  return { ok: true };
}

export async function hasReleasePin(tenantId: number): Promise<boolean> {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  return !!settings?.releasePinHash;
}

export async function verifyReleasePin(tenantId: number, pin: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!settings?.releasePinHash) {
    return { ok: false, error: "No hay una clave configurada todavía" };
  }
  if (settings.releasePinLockedUntil && settings.releasePinLockedUntil.getTime() > Date.now()) {
    const secondsLeft = Math.ceil((settings.releasePinLockedUntil.getTime() - Date.now()) / 1000);
    return { ok: false, error: `Demasiados intentos fallidos. Intenta de nuevo en ${secondsLeft}s.` };
  }

  const matches = await bcrypt.compare(pin, settings.releasePinHash);
  if (!matches) {
    const failedAttempts = (settings.releasePinFailedAttempts || 0) + 1;
    const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { releasePinFailedAttempts: failedAttempts, releasePinLockedUntil: lockedUntil },
    });
    if (lockedUntil) {
      return { ok: false, error: `Clave incorrecta. Demasiados intentos — bloqueado por 5 minutos.` };
    }
    return { ok: false, error: `Clave incorrecta (intento ${failedAttempts}/${MAX_FAILED_ATTEMPTS}).` };
  }

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: { releasePinFailedAttempts: 0, releasePinLockedUntil: null },
  });
  return { ok: true };
}

// Token corto, de un solo uso, atado a UNA orden específica — se emite
// recién después de validar el PIN o la huella. Nunca se puede reutilizar
// para otra orden ni más de una vez (ver consumeReleaseAuthToken).
export async function issueReleaseAuthToken(tenantId: number, orderNumber: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.p2PReleaseAuthToken.create({
    data: { tenantId, orderNumber, token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

export async function consumeReleaseAuthToken(tenantId: number, orderNumber: string, token: string): Promise<boolean> {
  if (!token) return false;
  const row = await prisma.p2PReleaseAuthToken.findUnique({ where: { token } });
  if (!row || row.tenantId !== tenantId || row.orderNumber !== orderNumber || row.used) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  await prisma.p2PReleaseAuthToken.update({ where: { id: row.id }, data: { used: true } });
  return true;
}
