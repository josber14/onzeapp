// Capa de "entendimiento" opcional sobre el chat P2P — SOLO clasifica la
// intención del comprador, nunca decide acciones de dinero. El código
// determinístico de chat-agent.ts sigue siendo el único que elige qué cuenta
// bancaria, qué monto o qué banco se manda; esta función únicamente le dice
// a ese código CUÁL de sus ramas ya existentes usar cuando el matching por
// palabras clave no dio un resultado claro.
//
// Si no hay ANTHROPIC_API_KEY configurada, si la llamada falla, o si tarda
// más de 4s, devuelve null — el llamador cae al comportamiento de palabras
// clave de siempre. Nunca debe ser un punto único de falla para el bot.

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 4000;

export interface IntentResult {
  intent: string;
  extractedBank?: string;
  extractedAmountClp?: number;
  isCompany?: boolean;
  followUpText?: string;
}

export async function classifyIntent(params: {
  state: string;
  text: string;
  validIntents: string[];
  context?: string;
}): Promise<IntentResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { state, text, validIntents, context } = params;

  const tool = {
    name: "clasificar_intencion",
    description: "Clasifica el mensaje de un comprador en una intención predefinida.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", enum: validIntents, description: "La intención que mejor describe el mensaje." },
        extractedBank: { type: "string", description: "Nombre de un banco chileno si lo menciona explícitamente (ej. 'Banco de Chile'). Omitir si no menciona ninguno." },
        extractedAmountClp: { type: "number", description: "Monto en pesos chilenos (CLP) si menciona uno relevante para un límite o pago. Omitir si no menciona monto." },
        isCompany: { type: "boolean", description: "true si menciona que transfiere desde una cuenta empresa / necesita factura o ERUT. Omitir si no lo menciona." },
        followUpText: { type: "string", description: "Solo si intent es 'reports_problem' o similar: una pregunta corta y empática (máximo 20 palabras, español chileno, cercano) para entender qué le pasó al comprador. Nunca menciones cuentas, montos ni bancos aquí." },
      },
      required: ["intent"],
    },
  };

  const system = `Eres el clasificador de intención del chat de un negocio de compra/venta de USDT en Chile (P2P Binance).
Un comprador está en la conversación, en el estado interno "${state}".
${context ? context + "\n" : ""}Tu única tarea: leer su mensaje y devolver, usando la herramienta clasificar_intencion, la intención que mejor lo describe entre: ${validIntents.join(", ")}.
No inventes información. No decidas montos ni cuentas — solo extrae lo que el comprador diga explícitamente, si acaso.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: text }],
        tools: [tool],
        tool_choice: { type: "tool", name: "clasificar_intencion" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const toolUse = (data?.content ?? []).find((c: any) => c.type === "tool_use");
    if (!toolUse?.input?.intent || !validIntents.includes(toolUse.input.intent)) return null;
    return toolUse.input as IntentResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
