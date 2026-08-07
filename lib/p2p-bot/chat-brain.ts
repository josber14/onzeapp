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
  exchange?: string;
}): Promise<IntentResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { state, text, validIntents, context } = params;
  // Bug real confirmado en vivo (jul 2026): el system prompt tenía "Binance"
  // y "el vendedor" (en tercera persona) escritos fijos -- en una orden real
  // de BYBIT, el followUpText generado le dijo al comprador "quedamos
  // atentos a que el vendedor confirme el pago para liberar tus USDT en
  // Binance", mencionando un exchange que no es el de esa orden y hablando
  // del vendedor como si fuera un tercero ajeno (cuando el vendedor somos
  // NOSOTROS). El nombre del exchange ahora se pasa como parámetro en cada
  // llamada (ver chat-agent.ts) en vez de asumir Binance siempre.
  const exchangeName = params.exchange
    ? params.exchange.charAt(0).toUpperCase() + params.exchange.slice(1)
    : "Binance";

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

  const system = `Eres el clasificador de intención del chat de un negocio de compra/venta de USDT en Chile (P2P ${exchangeName}).
Un comprador está en la conversación, en el estado interno "${state}".

CÓMO FUNCIONA ESTA OPERACIÓN (no te equivoques con la dirección del dinero):
- El comprador está comprando USDT. Los USDT se liberan automáticamente en su cuenta de ${exchangeName} cuando NOSOTROS (el vendedor) confirmamos el pago — nunca transferimos USDT a un banco ni a ninguna cuenta bancaria. Habla siempre en primera persona ("vamos a validar tu pago", "en cuanto confirmemos, liberamos tus USDT") — NUNCA en tercera persona como si "el vendedor" fuera alguien más, nosotros somos el vendedor.
- Lo que el comprador elige es a CUÁL DE NUESTRAS cuentas bancarias le va a transferir los PESOS CHILENOS (CLP) para pagar esta compra.
- Nunca digas frases como "el banco a donde quieres que te transfiera los USDT" o similar — eso es exactamente al revés e invento un dato que confunde al comprador.
- Si el comprador pregunta si PUEDE PAGAR DESDE VARIAS CUENTAS SUYAS (ej. "¿puedo transferir desde varias cuentas hasta completar el pago?") para juntar el monto total, es una pregunta legítima y la respuesta es SÍ — siempre que todas esas cuentas sean a su propio nombre (el mismo titular de la orden), y que envíe el comprobante de cada transferencia. Esto es DISTINTO de pedir nuestras cuentas o de reportar un problema — no lo confundas con "no funciona la cuenta" ni le ofrezcas una cuenta alternativa nuestra si no es lo que pidió.
- Si el mensaje es (o incluye) un agradecimiento ("gracias", "muchas gracias", "te agradezco"), SIEMPRE respóndele el agradecimiento de vuelta (ej. "Gracias a ti", "Gracias a ti por tu preferencia") de forma cálida — nunca lo ignores ni respondas solo con la pregunta pendiente sin reconocer que te agradeció. Ajusta el resto de tu respuesta según POR QUÉ está agradeciendo, usando el contexto: si agradece justo después de recibir la cuenta y todavía NO hay ningún indicio de que ya pagó, dile SOLO que quedas atento a su pago (ej. "Gracias a ti, quedamos atentos a tu pago") y tu respuesta TERMINA AHÍ — en ese caso el followUpText NO debe contener ningún signo de interrogación ni ninguna pregunta, sea cual sea su redacción (nada de "¿ya transferiste?", "¿pudiste realizar el pago?", "necesitamos que confirmes si...", "¿hay algo en lo que pueda ayudarte?", ni ninguna otra variante que en el fondo pregunte por el estado del pago o si necesita algo más) — esta regla es sobre la INTENCIÓN de la pregunta, no sobre memorizar frases puntuales: un simple "gracias" nunca amerita ninguna pregunta de vuelta, sin importar cómo la redactes. Si agradece después de que le resolviste un problema o una duda, dile que fue un gusto ayudarlo (mismo criterio: sin agregar ninguna pregunta). Si agradece sin un motivo claro en el contexto, un "Gracias a ti" simple es suficiente — solo retoma la pregunta pendiente si el estado realmente tiene una pregunta de menú sin responder (ej. elegir banco), nunca inventes una pregunta nueva que no se le había hecho antes.

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

// Extrae el primer nombre de pila de un nombre legal completo (formato
// documento de identidad latinoamericano) para poder saludar a un
// comprador por su nombre real, no por su apellido.
//
// Bug real confirmado en vivo (jul 2026): el código anterior asumía un
// orden FIJO ("APELLIDO1 APELLIDO2 NOMBRE1 [NOMBRE2]", tomando siempre la
// 3ra palabra) -- pero revisando 20 nombres reales capturados, casi la
// mitad venían al revés ("NOMBRE1 [NOMBRE2] APELLIDO1 APELLIDO2"), sin
// ningún patrón fijo que distinga un caso del otro (varía según el país de
// origen / tipo de documento del comprador). No existe una posición que
// funcione siempre -- se usa IA para reconocer, con conocimiento real de
// nombres/apellidos hispanos comunes, cuál palabra es de verdad un nombre
// de pila. Se llama UNA SOLA VEZ por comprador (al capturar realName), no
// en cada mensaje -- ver dónde se guarda el resultado en P2PChatState /
// P2PBuyerIdentity.firstName.
export async function resolveFirstName(fullLegalName: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const tool = {
    name: "extraer_primer_nombre",
    description: "Identifica el primer nombre de pila de una persona a partir de su nombre legal completo.",
    input_schema: {
      type: "object",
      properties: {
        firstName: {
          type: "string",
          description: "Solo el primer nombre de pila de la persona (nunca un apellido), tal como se usaría para saludarla de forma cercana y natural (ej. 'Juan', 'María', 'Óscar').",
        },
      },
      required: ["firstName"],
    },
  };

  const system = `Te doy el nombre legal completo de una persona latinoamericana, tal como aparece en un documento de identidad (cédula/RUT). El orden de las palabras VARÍA según el país/documento -- a veces son "APELLIDO1 APELLIDO2 NOMBRE1 [NOMBRE2]" y a veces "NOMBRE1 [NOMBRE2] APELLIDO1 APELLIDO2". No asumas un orden fijo: usa tu conocimiento de nombres y apellidos hispanos comunes para reconocer cuál palabra es realmente un nombre de pila (nunca un apellido). Devuelve SOLO ese primer nombre de pila, tal como se usaría para saludar a la persona de forma cercana y natural.`;

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
        max_tokens: 100,
        system,
        messages: [{ role: "user", content: fullLegalName }],
        tools: [tool],
        tool_choice: { type: "tool", name: "extraer_primer_nombre" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const toolUse = (data?.content ?? []).find((c: any) => c.type === "tool_use");
    const name = toolUse?.input?.firstName;
    if (!name || typeof name !== "string" || name.trim().length < 2) return null;
    return name.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ImageClassifyResult {
  documentType: "erut" | "payment_receipt" | "id_document" | "other";
  amountClp?: number;
}

// Reconoce QUÉ es una imagen que mandó el comprador (ERUT, comprobante de
// pago, cédula, u otra cosa) -- pedido explícito del usuario (ago 2026): hoy
// el bot recibe imágenes pero nunca mira su contenido, solo sabe que "llegó
// una imagen". Igual que classifyIntent, es puramente informativo -- NUNCA
// decide por sí sola que un pago está confirmado ni libera nada; eso sigue
// dependiendo exclusivamente del estado real de la orden en el exchange (ver
// chat-agent.ts). Mismo principio de nunca ser punto único de falla: sin
// ANTHROPIC_API_KEY, si la descarga de la imagen falla, o si tarda más de
// VISION_TIMEOUT_MS, devuelve null y el bot sigue exactamente igual que
// antes de agregar esto (ignora la imagen en silencio).
const VISION_MODEL = "claude-haiku-4-5";
const VISION_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function classifyImage(imageUrl: string): Promise<ImageClassifyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const imgRes = await fetch(imageUrl, { signal: controller.signal });
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const mediaType = contentType.includes("png") ? "image/png" : contentType.includes("webp") ? "image/webp" : "image/jpeg";
    const buf = Buffer.from(await imgRes.arrayBuffer());
    // Techo defensivo -- Binance ya comprime lo que sube por chat, esto solo
    // evita mandar algo desproporcionado a la API si alguna vez llega distinto.
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    const base64 = buf.toString("base64");

    const tool = {
      name: "clasificar_imagen",
      description: "Clasifica una imagen enviada por un comprador en el chat de una compra P2P de USDT en Chile.",
      input_schema: {
        type: "object",
        properties: {
          documentType: {
            type: "string",
            enum: ["erut", "payment_receipt", "id_document", "other"],
            description:
              "'erut' = documento E-RUT de una empresa chilena (el certificado del SII con el RUT de la empresa). 'payment_receipt' = comprobante o captura de pantalla de una transferencia bancaria o pago (banco chileno, Mercado Pago, etc). 'id_document' = cédula de identidad u otro documento de identidad de una persona. 'other' = cualquier otra cosa (foto sin relación, captura de otra app, etc).",
          },
          amountClp: {
            type: "number",
            description:
              "SOLO si documentType es 'payment_receipt' y el monto en pesos chilenos (CLP) aparece CLARAMENTE legible en la imagen: el monto exacto transferido, sin puntos ni separadores (ej. 225000, no 225.000). Omitir por completo el campo si no es un comprobante, o si el monto no se alcanza a leer con total certeza -- nunca adivines ni redondees un número que no se ve nítido.",
          },
        },
        required: ["documentType"],
      },
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Clasifica esta imagen." },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "tool", name: "clasificar_imagen" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const toolUse = (data?.content ?? []).find((c: any) => c.type === "tool_use");
    const documentType = toolUse?.input?.documentType;
    if (!documentType) return null;
    const result: ImageClassifyResult = { documentType };
    if (typeof toolUse.input.amountClp === "number" && toolUse.input.amountClp > 0) {
      result.amountClp = toolUse.input.amountClp;
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
