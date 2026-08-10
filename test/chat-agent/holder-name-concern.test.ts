// Prueba de regresión (ago 2026, orden de 1.540.000 CLP): el cliente escribió
// "Lo haré desde Tenpo y Mercado pago" (avisando que iba a pagar dividido
// desde esos dos métodos) y el bot respondió con el mensaje fijo de "el
// titular real es Josber Marcano..." -- totalmente fuera de contexto, nadie
// preguntó por el nombre del titular.
//
// Causa raíz: mentionsExpectedHolderName tolera hasta 2 letras de diferencia
// (Levenshtein) para reconocer variantes con errores de tipeo del apellido
// real ("Marcanoo", "Josver", "Yosber"). "mercado" está a distancia 2 de
// "marcano" (7 letras, 2 sustituciones) -- una coincidencia real de letras
// con una palabra española común, no un typo del apellido.
import { describe, it, expect, vi } from "vitest";

// chat-agent.ts importa @/lib/prisma al cargar el módulo -- se mockea igual
// que en el resto de test/chat-agent/, aunque esta prueba no lo necesite.
vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
vi.doMock("../../lib/p2p-bot/chat-lock", () => ({
  acquireChatLock: async () => true,
  releaseChatLock: async () => {},
}));

const { matchHolderNameConcern } = await import("../../lib/p2p-bot/chat-agent");

describe("matchHolderNameConcern", () => {
  it("NO se dispara con 'Mercado Pago' (bug real confirmado en vivo)", () => {
    expect(matchHolderNameConcern("Lo haré desde Tenpo y Mercado pago.")).toBe(false);
    expect(matchHolderNameConcern("voy a pagar con mercado pago")).toBe(false);
  });

  it("sigue reconociendo los typos reales ya documentados del apellido/nombre", () => {
    expect(matchHolderNameConcern("el titular se llama Josver Marcano?")).toBe(true);
    expect(matchHolderNameConcern("es de Yosber?")).toBe(true);
    expect(matchHolderNameConcern("dice Marcanoo en la cuenta")).toBe(true);
  });

  it("sigue reconociendo el nombre real exacto y las frases explícitas de duda", () => {
    expect(matchHolderNameConcern("por qué dice Josber Marcano?")).toBe(true);
    expect(matchHolderNameConcern("el titular es otro nombre")).toBe(true);
    expect(matchHolderNameConcern("el nombre no coincide con Zinple")).toBe(true);
  });
});
