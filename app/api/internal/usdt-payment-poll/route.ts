import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import {
  parseBankEmail,
  expectedDomainFor,
  verifyBankEmailAuthenticity,
  extractAuthResultsHeaders,
} from "@/lib/usdt-bank-email-parser";
import { recordIncomingTransfer } from "@/lib/usdt-payment-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Único tenant real hoy (mismo criterio ya usado en todo lib/p2p-bot/* y en
// los scripts de mantenimiento — ver AGENTS.md).
const TENANT_ID = 1;

const SENDER_ADDRESSES = ["mensajeria@santander.cl", "noreply@somosmach.com"];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Disparado por el cron de Vercel (cada 1 minuto, ver vercel.json) — lee la
// bandeja dedicada por IMAP, procesa los avisos de transferencia recibida
// nuevos, y los deja marcados como leídos. Nunca ejecuta ninguna acción de
// dinero acá — solo registra lo que llegó (ver lib/usdt-payment-matcher.ts).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const host = process.env.IMAP_HOST || "imap.gmail.com";
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;
  if (!user || !pass) {
    return NextResponse.json({ ok: false, error: "Falta IMAP_USER/IMAP_PASS" }, { status: 500 });
  }

  // imapflow por defecto espera hasta 90s para conectar y 16s para el saludo
  // del servidor — más que el límite de 60s de esta función en Vercel. Si
  // algo falla (credenciales, red, IMAP deshabilitado), en vez de un error
  // claro se producía un "Task timed out" sin ningún detalle útil. Acortado
  // para que falle rápido y devuelva la razón real dentro del presupuesto de
  // tiempo de la función.
  const client = new ImapFlow({
    host, port, secure: true, auth: { user, pass }, logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    const uids = await client.search({ seen: false }, { uid: true });

    for (const uid of uids || []) {
      try {
        const raw = await client.download(String(uid), undefined, { uid: true });
        if (!raw?.content) {
          skipped++;
          continue;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of raw.content) chunks.push(chunk as Buffer);
        const rawBuffer = Buffer.concat(chunks);
        const rawSource = rawBuffer.toString("utf8");

        const parsedMail = await simpleParser(rawBuffer);
        const fromAddress = parsedMail.from?.value?.[0]?.address || "";

        if (!SENDER_ADDRESSES.some((addr) => fromAddress.toLowerCase().includes(addr))) {
          await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
          skipped++;
          continue;
        }

        const expectedDomain = expectedDomainFor(fromAddress);
        const authHeaders = extractAuthResultsHeaders(rawSource);
        const authPassed = expectedDomain ? verifyBankEmailAuthenticity(authHeaders, expectedDomain) : false;

        const subject = parsedMail.subject || "";
        const bodyHtmlOrText = parsedMail.html || parsedMail.text || "";
        const parsed = parseBankEmail({ from: fromAddress, subject, bodyHtmlOrText });

        const messageId = parsedMail.messageId || `no-message-id-${uid}-${Date.now()}`;
        const existing = await prisma.usdtIncomingTransfer.findUnique({ where: { emailMessageId: messageId } });

        if (!existing) {
          if (authPassed && parsed) {
            // Solo un correo que pasó la autenticación real Y se pudo
            // parsear entra al flujo normal de matching (código / nombre).
            await recordIncomingTransfer(TENANT_ID, {
              amountClp: parsed.amountClp,
              payerName: parsed.payerName,
              rawComment: parsed.rawComment,
              emailMessageId: messageId,
              sourceEmail: fromAddress,
              authPassed: true,
              receivedAt: parsedMail.date || new Date(),
            });
          } else {
            // No pasó la autenticación real, o no se pudo parsear el
            // contenido — nunca se le da el beneficio de la duda intentando
            // matchear por código: se registra igual (para que quede
            // visible en la bandeja de revisión manual, nunca desaparece en
            // silencio) pero sin tocar ningún UsdtPurchaseIntent.
            await prisma.usdtIncomingTransfer.create({
              data: {
                tenantId: TENANT_ID,
                purchaseIntentId: null,
                amountClp: parsed?.amountClp ?? 0,
                payerName: parsed?.payerName ?? null,
                rawComment: parsed?.rawComment ?? null,
                matchMethod: null,
                needsReview: true,
                emailMessageId: messageId,
                sourceEmail: fromAddress,
                authPassed,
                receivedAt: parsedMail.date || new Date(),
              },
            });
          }
        }

        await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
        processed++;
      } catch (e: any) {
        errors.push(`uid ${uid}: ${e.message}`);
      }
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally {
    await client.logout().catch(() => {});
  }

  return NextResponse.json({ ok: true, processed, skipped, errors });
}
