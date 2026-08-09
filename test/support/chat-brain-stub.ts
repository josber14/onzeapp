// Controlador compartido para el mock de lib/p2p-bot/chat-brain.ts (las
// llamadas reales a Claude) -- cada prueba encola las respuestas que quiere
// que la IA "devuelva" en orden, sin pegarle a la API real. Ver el patrón de
// uso en test/chat-agent/*.test.ts (vi.mock apuntando a este stub).

type ClassifyIntentResult = {
  intent: string;
  followUpText?: string;
  extractedAmountClp?: number;
} | null;

type ClassifyImageResult = {
  documentType: "erut" | "payment_receipt" | "id_document" | "payment_error" | "other";
  amountClp?: number;
} | null;

const classifyIntentQueue: ClassifyIntentResult[] = [];
const classifyImageQueue: ClassifyImageResult[] = [];

export const chatBrainStub = {
  queueIntent(result: ClassifyIntentResult) {
    classifyIntentQueue.push(result);
  },
  queueImage(result: ClassifyImageResult) {
    classifyImageQueue.push(result);
  },
  reset() {
    classifyIntentQueue.length = 0;
    classifyImageQueue.length = 0;
  },
  async classifyIntent() {
    // Si la prueba no encoló nada, se comporta como "la IA no dio nada
    // claro" (null) -- exactamente lo que pasa en producción cuando no hay
    // ANTHROPIC_API_KEY o la llamada falla, así que el flujo normal de
    // matchers por palabra clave sigue sin la IA como respaldo.
    return classifyIntentQueue.length ? classifyIntentQueue.shift()! : null;
  },
  async resolveFirstName(fullLegalName: string) {
    // Heurística simple y determinística para pruebas: primera palabra.
    return fullLegalName ? fullLegalName.trim().split(/\s+/)[0] : null;
  },
  async classifyImage() {
    return classifyImageQueue.length ? classifyImageQueue.shift()! : null;
  },
};
