import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySkipoWebhookSignature } from "@/lib/skipo-webhook-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deduplicación simple en memoria por "id" lógico del evento (distinto del
// delivery id, que cambia en cada reintento) -- evita reprocesar el mismo
// evento si Skipo reintenta la entrega. No sobrevive un reinicio del
// servidor, pero eso es aceptable: reprocesar un evento de estado es
// inofensivo (aplicar el mismo estado 2 veces no hace daño), esto es solo
// una optimización, nunca la única defensa.
const recentEventIds = new Set<string>();
const MAX_RECENT_EVENTS = 500;

export async function POST(req: NextRequest) {
  const signatureHeader = req.headers.get("skipo-webhook-signature");
  if (!signatureHeader) {
    return NextResponse.json({ error: "falta firma" }, { status: 401 });
  }

  // CRÍTICO: se lee el body como texto CRUDO y se verifica la firma contra
  // esos mismos bytes ANTES de parsear JSON -- reserializar el JSON después
  // de parsearlo invalida la firma (ver lib/skipo-webhook-verify.ts).
  const rawBodyText = await req.text();
  const rawBody = Buffer.from(rawBodyText, "utf8");

  const verification = await verifySkipoWebhookSignature(signatureHeader, rawBody);
  if (!verification.valid) {
    console.error(`[SkipoWebhook] Firma inválida: ${verification.reason}`);
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const eventId = String(event?.id || "");
  if (eventId) {
    if (recentEventIds.has(eventId)) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    recentEventIds.add(eventId);
    if (recentEventIds.size > MAX_RECENT_EVENTS) {
      const first = recentEventIds.values().next().value;
      if (first) recentEventIds.delete(first);
    }
  }

  const eventType = String(event?.eventType || "");

  try {
    if (eventType === "withdrawal.status.updated" || eventType === "withdrawal.created") {
      await handleWithdrawalEvent(event);
    }
    // deposit.*, order.*, fill.* -- no aplican todavía a nuestro flujo
    // actual (solo hacemos retiros vía Skipo), se ignoran en silencio. Si
    // en el futuro se necesitan, agregar su propio handler acá.
  } catch (e: any) {
    console.error(`[SkipoWebhook] Error procesando evento ${eventType}: ${e.message}`);
    // Se responde 2xx igual -- un error nuestro procesando no debe hacer que
    // Skipo reintente indefinidamente ni suspenda el webhook. Queda logueado
    // para revisar a mano.
  }

  return NextResponse.json({ ok: true });
}

async function handleWithdrawalEvent(event: any) {
  const providerWithdrawalId = String(event?.data?.id || event?.resourceId || "");
  if (!providerWithdrawalId) return;

  const rawStatus = String(event?.data?.status || "").toUpperCase();
  const mappedStatus =
    rawStatus === "COMPLETED" ? "completed"
    : rawStatus === "FAILED" || rawStatus === "REJECTED" || rawStatus === "CANCELLED" ? "failed"
    : "pending";

  const updated = await prisma.usdtWithdrawal.updateMany({
    where: { providerWithdrawalId },
    data: {
      status: mappedStatus,
      completedAt: mappedStatus === "completed" ? new Date() : undefined,
    },
  });

  if (updated.count === 0) {
    console.warn(`[SkipoWebhook] No se encontró UsdtWithdrawal con providerWithdrawalId=${providerWithdrawalId}`);
  }
}
