import { prisma } from "@/lib/prisma";
import { findReferenceCodeInText } from "@/lib/usdt-purchase";

function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .trim();
}

function nameWords(name: string): string[] {
  return normalizeName(name).split(/\s+/).filter((w) => w.length >= 2);
}

// Comparación difusa de nombres (KYC vs. lo que trae el correo del banco) —
// no exige coincidencia exacta ni el mismo orden (apellido-apellido-nombre vs
// nombre-apellido-apellido), solo suficientes palabras en común. Es a
// propósito permisivo: este resultado SIEMPRE queda pendiente de revisión
// manual del operador (ver recordIncomingTransfer), nunca se usa solo para
// aprobar automáticamente.
function namesLikelyMatch(a: string, b: string): boolean {
  const wordsA = new Set(nameWords(a));
  const wordsB = new Set(nameWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  let overlap = 0;
  for (const w of smaller) if (larger.has(w)) overlap++;
  const required = smaller.size === 1 ? 1 : 2;
  return overlap >= required;
}

export type MatchInput = {
  amountClp: number;
  payerName: string | null;
  rawComment: string | null;
};

export type MatchResult = {
  purchaseIntentId: number | null;
  matchMethod: "code" | "name_fallback" | null;
};

// Intenta identificar a qué solicitud de compra pertenece una transferencia
// recién detectada. El código de referencia es la única vía que se
// auto-aprueba (ver recordIncomingTransfer) — nombre+monto es solo un
// candidato sugerido para que el operador lo confirme.
export async function matchIncomingTransfer(tenantId: number, input: MatchInput): Promise<MatchResult> {
  const code = input.rawComment ? findReferenceCodeInText(input.rawComment) : null;
  if (code) {
    const intent = await prisma.usdtPurchaseIntent.findUnique({
      where: { tenantId_referenceCode: { tenantId, referenceCode: code } },
    });
    if (intent && intent.status === "awaiting_payment") {
      return { purchaseIntentId: intent.id, matchMethod: "code" };
    }
  }

  if (input.payerName) {
    const candidates = await prisma.usdtPurchaseIntent.findMany({
      where: { tenantId, status: "awaiting_payment" },
      include: { client: { select: { fullName: true } } },
    });
    const matches = candidates.filter((c) => namesLikelyMatch(c.client.fullName, input.payerName!));
    if (matches.length === 1) {
      return { purchaseIntentId: matches[0].id, matchMethod: "name_fallback" };
    }
  }

  return { purchaseIntentId: null, matchMethod: null };
}

// Registra la transferencia detectada. Un match por código queda confirmado
// de inmediato (needsReview: false) y suma al total real de la solicitud. Un
// match por nombre (o ningún match) queda SIEMPRE pendiente de que el
// operador lo confirme desde la bandeja de revisión — nunca suma solo.
export async function recordIncomingTransfer(tenantId: number, params: {
  amountClp: number;
  payerName: string | null;
  rawComment: string | null;
  emailMessageId: string;
  sourceEmail: string;
  authPassed: boolean;
  receivedAt: Date;
}) {
  const match = await matchIncomingTransfer(tenantId, {
    amountClp: params.amountClp,
    payerName: params.payerName,
    rawComment: params.rawComment,
  });
  const isCodeMatch = match.matchMethod === "code";

  const transfer = await prisma.usdtIncomingTransfer.create({
    data: {
      tenantId,
      purchaseIntentId: match.purchaseIntentId,
      amountClp: params.amountClp,
      payerName: params.payerName,
      rawComment: params.rawComment,
      matchMethod: match.matchMethod,
      needsReview: !isCodeMatch,
      emailMessageId: params.emailMessageId,
      sourceEmail: params.sourceEmail,
      authPassed: params.authPassed,
      receivedAt: params.receivedAt,
    },
  });

  if (isCodeMatch && match.purchaseIntentId) {
    await recalculateIntentTotal(match.purchaseIntentId);
  }

  return transfer;
}

// Suma solo las transferencias YA confirmadas (needsReview: false, ya sea por
// código automático o por revisión manual del operador) — nunca las que
// siguen pendientes de revisión.
export async function recalculateIntentTotal(purchaseIntentId: number) {
  const intent = await prisma.usdtPurchaseIntent.findUnique({ where: { id: purchaseIntentId } });
  if (!intent || intent.status !== "awaiting_payment") return;

  const confirmed = await prisma.usdtIncomingTransfer.findMany({
    where: { purchaseIntentId, needsReview: false },
  });
  const total = confirmed.reduce((sum, t) => sum + Number(t.amountClp), 0);

  const data: { receivedClp: number; status?: string; readyAt?: Date } = { receivedClp: total };
  if (total >= Number(intent.requestedClp)) {
    data.status = "ready_to_buy";
    data.readyAt = new Date();
  }
  await prisma.usdtPurchaseIntent.update({ where: { id: purchaseIntentId }, data });
}

// Llamado por el operador desde la bandeja de revisión manual — asocia (o
// reasigna) una transferencia sin identificar a un intent específico y recién
// ahí la suma al total real. Es el único lugar donde un match por nombre (o
// una transferencia que no matcheó nada) puede terminar habilitando "Comprar".
export async function confirmManualMatch(transferId: number, purchaseIntentId: number, reviewedByUserId: number) {
  const transfer = await prisma.usdtIncomingTransfer.update({
    where: { id: transferId },
    data: { purchaseIntentId, matchMethod: "manual", needsReview: false, reviewedByUserId },
  });
  await recalculateIntentTotal(purchaseIntentId);
  return transfer;
}
