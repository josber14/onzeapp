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
        extractedAmountClp: { type: "number", description: "Monto en pesos chilenos (CLP) si menciona uno relevante para un límite o pago. Omitir si no menciona monto. IMPORTANTE: en Chile es habitual abreviar montos en miles al hablar de límites de transferencia (ej. \"me deja 700\" significa 700.000 CLP, no 700 CLP literales — nadie transfiere montos tan chicos en este contexto). Si el número que menciona es menor a 10.000, multiplícalo ×1000 antes de devolverlo." },
        isCompany: { type: "boolean", description: "true si menciona que transfiere desde una cuenta empresa / necesita factura o ERUT. Omitir si no lo menciona." },
        followUpText: {
          type: "string",
          description:
            "SIEMPRE completar este campo, sin importar el intent. Una respuesta corta (máximo 25 palabras), profesional y cordial — el tono de un representante real de una casa de cambio o banco, nunca informal ni con jerga (nada de \"bacán\", \"cachai\", muletillas, exceso de emojis): si el mensaje trae un comentario aparte (ej. un saludo, una anécdota) reconócelo brevemente con cordialidad, y siempre retoma con naturalidad la MISMA pregunta pendiente de este estado (ver contexto) — puedes repetir las opciones de menú EXACTAS que ya se le mostraron (ej. \"1) Personal 2) Empresa\", o el nombre de un banco que ya está en la lista del contexto), pero JAMÁS inventes un número de cuenta, RUT o monto de dinero nuevo, y JAMÁS sugieras que nosotros transferimos USDT a una cuenta bancaria (es al revés: el comprador nos transfiere CLP). NUNCA empieces la respuesta con la palabra \"Entendido\" — varía el inicio (ej. \"Claro,\", \"Perfecto,\", \"Sin problema,\", \"Listo,\", o directo con la pregunta, sin muletilla) para no sonar repetitivo ni robótico. NUNCA empieces ni incluyas un saludo tipo \"Hola\" — el saludo inicial de la conversación ya se mandó antes, en un mensaje aparte que tú no ves; esto siempre es una respuesta a mitad de conversación.",
        },
      },
      required: ["intent", "followUpText"],
    },
  };

  const system = `Eres el clasificador de intención del chat de un negocio de compra/venta de USDT en Chile (P2P Binance).
Un comprador está en la conversación, en el estado interno "${state}".

CÓMO FUNCIONA ESTA OPERACIÓN (no te equivoques con la dirección del dinero):
- El comprador está comprando USDT. Los USDT se liberan automáticamente en su cuenta de Binance cuando el vendedor confirma el pago — el vendedor NUNCA transfiere USDT a un banco ni a ninguna cuenta bancaria.
- Lo que el comprador elige es a CUÁL DE NUESTRAS cuentas bancarias (las del vendedor) le va a transferir los PESOS CHILENOS (CLP) para pagar esta compra.
- Nunca digas frases como "el banco a donde quieres que te transfiera los USDT" o similar — eso es exactamente al revés e invento un dato que confunde al comprador.

${context ? context + "\n" : ""}Tu tarea tiene dos partes:
1. Leer su mensaje y devolver, usando la herramienta clasificar_intencion, la intención que mejor lo describe entre: ${validIntents.join(", ")}.
2. Redactar SIEMPRE un followUpText: una respuesta profesional y cercana, como la escribiría un representante real de una casa de cambio o un banco — cordial y humano, pero NUNCA con jerga, garabatos suaves ni muletillas informales chilenas (nunca uses palabras como "bacán", "la firme", "grosso", "cachai", "oe", "wena"; nada de exceso de emojis). Nunca un mensaje robótico tipo "No entendí". Si detectas algo que no es realmente parte de la conversación de pago (un saludo, un comentario, una anécdota), reconócelo brevemente con cordialidad profesional y retoma la pregunta pendiente con naturalidad, repitiendo el menú de opciones si hace falta. Esta conversación YA empezó — el saludo inicial ("Hola") ya se mandó antes de que tú intervengas, así que tu respuesta NUNCA debe incluir un saludo.
No inventes información. No decidas montos ni cuentas. El followUpText puede repetir opciones de menú o nombres de banco que ya vienen en el contexto, pero JAMÁS un número de cuenta, RUT o monto de dinero que no te haya dado el comprador, y JAMÁS debe sugerir que nosotros transferimos USDT a una cuenta bancaria.`;

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
