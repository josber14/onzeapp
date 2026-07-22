import { randomInt } from "crypto";

// Alfabeto sin 0/O/1/I — evita que el cliente confunda un carácter con otro
// al copiar el código a mano en el comentario/glosa de su transferencia.
const REFERENCE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REFERENCE_CODE_LENGTH = 6;

export function generateReferenceCode(): string {
  let code = "";
  for (let i = 0; i < REFERENCE_CODE_LENGTH; i++) {
    code += REFERENCE_CODE_ALPHABET[randomInt(REFERENCE_CODE_ALPHABET.length)];
  }
  return code;
}

// Busca un código de referencia válido dentro de un texto libre (ej. el
// comentario/glosa de una transferencia) — exige los 6 caracteres del
// alfabeto seguidos, como palabra completa, para no matchear por accidente
// un fragmento de otra palabra.
export function findReferenceCodeInText(text: string): string | null {
  if (!text) return null;
  const pattern = new RegExp(`\\b[${REFERENCE_CODE_ALPHABET}]{${REFERENCE_CODE_LENGTH}}\\b`, "i");
  const match = text.toUpperCase().match(pattern);
  return match ? match[0] : null;
}
