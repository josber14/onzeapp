// Parser de los avisos de "transferencia recibida" que llegan por correo —
// diseñado contra 2 ejemplos REALES revisados con el usuario (no inventados):
// un comprobante directo de Santander y un aviso de MACH. Ambos remitentes
// mandan más de una plantilla desde la misma dirección, así que el "asunto"
// es tan importante como el remitente para no confundir un correo saliente
// con uno entrante.

const SANTANDER_FROM = "mensajeria@santander.cl";
const SANTANDER_DOMAIN = "santander.cl";
const MACH_FROM = "noreply@somosmach.com";
const MACH_DOMAIN = "somosmach.com";

export type ParsedBankEmail = {
  template: "santander_incoming" | "mach_incoming";
  amountClp: number;
  payerName: string | null;
  rawComment: string | null;
} | null;

function htmlToText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Formato chileno: "$ 100.000" — el punto es separador de miles, nunca
// decimal en CLP.
function parseClpAmount(raw: string): number {
  const cleaned = raw.replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

// Cuando el campo "Comentario" viene vacío, el texto legal de más abajo
// (disclaimer, "no responder este correo", etc.) puede quedar pegado al
// mismo renglón según cómo el correo convierte su HTML a texto plano. Un
// código de referencia real nunca empieza así, así que se descarta.
const COMMENT_BOILERPLATE = /^(antes de imprimir|nota:|si tiene cualquier duda|inf[oó]rmese sobre)/i;
function cleanComment(raw: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed || COMMENT_BOILERPLATE.test(trimmed)) return null;
  return trimmed;
}

export function parseBankEmail(params: { from: string; subject: string; bodyHtmlOrText: string }): ParsedBankEmail {
  const from = params.from.toLowerCase();
  const subject = params.subject.toLowerCase();
  const text = htmlToText(params.bodyHtmlOrText);

  if (from.includes(SANTANDER_FROM)) {
    // Santander manda DOS plantillas desde la misma dirección: "Aviso de
    // Transferencia de Fondos" es cuando NOSOTROS enviamos plata (nunca debe
    // contarse como pago recibido de un cliente) — "Comprobante Transferencia
    // de fondos" es cuando alguien nos transfiere A NOSOTROS. Si el asunto no
    // es claramente la segunda, se ignora sin asumir nada.
    if (!subject.includes("comprobante")) return null;

    const nameMatch = text.match(/nuestro cliente\s+(.+?)\s+realiz[oó]\s+una transferencia/i);
    const amountMatch = text.match(/Monto transferido\s*\$?\s*([\d.,]+)/i);
    const commentMatch = text.match(/Comentario\s*\n?\s*([^\n]*)/i);
    if (!amountMatch) return null;

    return {
      template: "santander_incoming",
      amountClp: parseClpAmount(amountMatch[1]),
      payerName: nameMatch ? nameMatch[1].trim() : null,
      rawComment: cleanComment(commentMatch ? commentMatch[1] : null),
    };
  }

  if (from.includes(MACH_FROM)) {
    if (!subject.includes("recibiste una transferencia")) return null;

    const nameMatch =
      text.match(/Acabas de recibir una transferencia de\s+(.+?)\s+sin costo/i) ||
      params.subject.match(/Recibiste una transferencia de\s+(.+)/i);
    const amountMatch = text.match(/\bMonto\s*\$?\s*([\d.,]+)/i);
    if (!amountMatch) return null;

    return {
      template: "mach_incoming",
      amountClp: parseClpAmount(amountMatch[1]),
      payerName: nameMatch ? nameMatch[1].trim() : null,
      // MACH no expone ningún campo de comentario/glosa editable por quien
      // paga — el código de referencia nunca puede viajar por acá.
      rawComment: null,
    };
  }

  return null;
}

export function expectedDomainFor(from: string): string | null {
  const f = from.toLowerCase();
  if (f.includes(SANTANDER_FROM)) return SANTANDER_DOMAIN;
  if (f.includes(MACH_FROM)) return MACH_DOMAIN;
  return null;
}

// DKIM sobrevive un reenvío (la firma la pone el dominio original y no
// depende de qué IP relayó el mensaje) — SPF casi siempre falla tras un
// reenvío porque cambia la IP de origen. Por eso acá se prioriza dkim=pass
// sobre spf=pass. Se revisan TODAS las cabeceras Authentication-Results del
// mensaje (puede haber una por cada salto de reenvío) buscando la que
// corresponda al dominio esperado — nunca basta con mirar solo la del último
// salto. Ajustar/calibrar esta lógica contra un reenvío real es un paso
// pendiente explícito del plan (no se puede terminar de afinar solo con los
// 2 ejemplos de texto ya vistos).
export function verifyBankEmailAuthenticity(authResultsHeaders: string[], expectedDomain: string): boolean {
  for (const header of authResultsHeaders) {
    const dkimPass = new RegExp(`dkim=pass[^;]*header\\.[di]=[^;]*${expectedDomain}`, "i").test(header);
    if (dkimPass) return true;
    const spfPass = new RegExp(`spf=pass[^;]*smtp\\.mailfrom=[^;]*${expectedDomain}`, "i").test(header);
    if (spfPass) return true;
  }
  return false;
}

// Extrae TODAS las líneas "Authentication-Results" del mensaje crudo
// (RFC822) — puede haber una por cada salto de reenvío, y las cabeceras
// pueden venir "plegadas" en varias líneas (las de continuación empiezan con
// espacio/tab). Se detiene en la primera línea vacía (fin de las cabeceras,
// inicio del cuerpo).
export function extractAuthResultsHeaders(rawSource: string): string[] {
  const lines = rawSource.split(/\r?\n/);
  const results: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (/^authentication-results\s*:/i.test(line)) {
      if (current !== null) results.push(current);
      current = line.replace(/^authentication-results\s*:/i, "").trim();
    } else if (current !== null && /^[ \t]/.test(line)) {
      current += " " + line.trim();
    } else {
      if (current !== null) {
        results.push(current);
        current = null;
      }
      if (line.trim() === "") break;
    }
  }
  if (current !== null) results.push(current);
  return results;
}
