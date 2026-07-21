import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";

const CHALLENGE_TTL_MS = 3 * 60 * 1000; // 3 min para completar la ceremonia

// El RP ID de WebAuthn tiene que ser EXACTAMENTE el dominio donde está
// corriendo la página en ese momento (nunca un valor fijo/hardcodeado) — si
// no coincide, el navegador rechaza la ceremonia. Se deriva del propio
// request para funcionar igual en localhost y en producción.
export function getRpIdAndOrigin(req: Request): { rpID: string; origin: string } {
  const host = req.headers.get("host") || "localhost:3000";
  const rpID = host.split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") || (rpID === "localhost" ? "http" : "https");
  return { rpID, origin: `${proto}://${host}` };
}

export async function buildRegistrationOptions(params: {
  tenantId: number;
  rpID: string;
  userName: string;
  userDisplayName: string;
}) {
  const existing = await prisma.p2PWebAuthnCredential.findMany({ where: { tenantId: params.tenantId } });
  const options = await generateRegistrationOptions({
    rpName: "ONZE Panel",
    rpID: params.rpID,
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports as any) || undefined,
    })),
    authenticatorSelection: {
      // "platform" = el sensor propio del dispositivo (Touch ID/Face
      // ID/Windows Hello) — pedido explícito del usuario, no una llave
      // externa (security key USB).
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await prisma.p2PWebAuthnChallenge.deleteMany({ where: { tenantId: params.tenantId, purpose: "register" } });
  await prisma.p2PWebAuthnChallenge.create({
    data: {
      tenantId: params.tenantId,
      challenge: options.challenge,
      purpose: "register",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export async function verifyRegistration(params: {
  tenantId: number;
  rpID: string;
  origin: string;
  response: any;
  deviceLabel?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const challengeRow = await prisma.p2PWebAuthnChallenge.findFirst({
    where: { tenantId: params.tenantId, purpose: "register" },
    orderBy: { createdAt: "desc" },
  });
  if (!challengeRow || challengeRow.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "El registro expiró, intenta de nuevo" };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: params.origin,
      expectedRPID: params.rpID,
      requireUserVerification: true,
    });
  } catch (e: any) {
    return { ok: false, error: e.message || "No se pudo verificar el registro" };
  } finally {
    await prisma.p2PWebAuthnChallenge.delete({ where: { id: challengeRow.id } }).catch(() => {});
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "Registro no verificado" };
  }

  const { credential } = verification.registrationInfo;
  await prisma.p2PWebAuthnCredential.create({
    data: {
      tenantId: params.tenantId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ? (credential.transports as any) : undefined,
      deviceLabel: params.deviceLabel || null,
    },
  });

  return { ok: true };
}

export async function buildAuthenticationOptions(params: { tenantId: number; rpID: string; orderNumber: string }) {
  const existing = await prisma.p2PWebAuthnCredential.findMany({ where: { tenantId: params.tenantId } });
  if (existing.length === 0) {
    return { ok: false as const, error: "No hay ninguna huella registrada todavía" };
  }

  const options = await generateAuthenticationOptions({
    rpID: params.rpID,
    userVerification: "required",
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports as any) || undefined,
    })),
  });

  await prisma.p2PWebAuthnChallenge.deleteMany({ where: { tenantId: params.tenantId, purpose: "authenticate" } });
  await prisma.p2PWebAuthnChallenge.create({
    data: {
      tenantId: params.tenantId,
      challenge: options.challenge,
      purpose: "authenticate",
      orderNumber: params.orderNumber,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return { ok: true as const, options };
}

export async function verifyAuthentication(params: {
  tenantId: number;
  rpID: string;
  origin: string;
  orderNumber: string;
  response: any;
}): Promise<{ ok: boolean; error?: string }> {
  const challengeRow = await prisma.p2PWebAuthnChallenge.findFirst({
    where: { tenantId: params.tenantId, purpose: "authenticate", orderNumber: params.orderNumber },
    orderBy: { createdAt: "desc" },
  });
  if (!challengeRow || challengeRow.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "La verificación expiró, intenta de nuevo" };
  }

  const credentialRow = await prisma.p2PWebAuthnCredential.findUnique({
    where: { credentialId: params.response?.id },
  });
  if (!credentialRow || credentialRow.tenantId !== params.tenantId) {
    return { ok: false, error: "Huella no reconocida" };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: params.origin,
      expectedRPID: params.rpID,
      credential: {
        id: credentialRow.credentialId,
        publicKey: new Uint8Array(credentialRow.publicKey),
        counter: Number(credentialRow.counter),
        transports: (credentialRow.transports as any) || undefined,
      },
      requireUserVerification: true,
    });
  } catch (e: any) {
    return { ok: false, error: e.message || "No se pudo verificar la huella" };
  } finally {
    await prisma.p2PWebAuthnChallenge.delete({ where: { id: challengeRow.id } }).catch(() => {});
  }

  if (!verification.verified) {
    return { ok: false, error: "Huella no verificada" };
  }

  // El contador SIEMPRE debe subir en cada uso real del autenticador — es
  // la defensa de WebAuthn contra un clon de la llave privada (replay
  // attack). Si no sube, algo no cuadra y no se debe confiar en el intento.
  await prisma.p2PWebAuthnCredential.update({
    where: { id: credentialRow.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter) },
  });

  return { ok: true };
}
