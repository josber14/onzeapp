// Prueba de regresión ANTES de extraer el patrón duplicado "resolvedProblem"
// (matchProblemType + respaldo de IA para "limit"/"not_working") que hoy
// vive casi idéntico en 2 estados: awaiting_bank_choice y account_sent.
// Fija el comportamiento actual (por palabra clave Y por IA) para poder
// refactorizar con la certeza de que ningún estado quedó distinto.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { createFakePrisma } = await import("../support/fake-prisma");
const { createFakeP2PClient } = await import("../support/fake-client");
const { makeOrder, makeDefaultAccounts } = await import("../support/fixtures");
const { chatBrainStub } = await import("../support/chat-brain-stub");

const fakePrisma = createFakePrisma();

vi.doMock("@/lib/prisma", () => ({ prisma: fakePrisma }));
vi.doMock("../../lib/p2p-bot/chat-lock", () => ({
  acquireChatLock: async () => true,
  releaseChatLock: async () => {},
}));
vi.doMock("../../lib/p2p-bot/chat-brain", () => chatBrainStub);

const { processOrder } = await import("../../lib/p2p-bot/chat-agent");

const TENANT_ID = 1;

fakePrisma.__seedAccounts(makeDefaultAccounts(TENANT_ID));

beforeEach(() => {
  chatBrainStub.reset();
});

describe("chat-agent: resolución de 'limite de banco' vs 'problema técnico'", () => {
  it("awaiting_bank_choice: reconoce 'limit' por PALABRA CLAVE (permite) y ofrece dividir el pago", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000 });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // saludo
    client.pushClientMessage("1"); // personal
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // ahora en awaiting_bank_choice

    // "permite" resuelve a "limit" por palabra clave, sin necesitar IA.
    client.pushClientMessage("el banco solo me permite 200000");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const sent = client.getSentMessages().join("\n");
    expect(sent).toMatch(/dividir el pago/i);

    const cs = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(cs.splitPaymentDeclared).toBe(true);
  });

  it("account_sent: cuando la palabra clave no alcanza, usa el respaldo de IA para 'limit'", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000 });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // saludo
    client.pushClientMessage("1"); // personal
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // awaiting_bank_choice

    client.pushClientMessage("banco de chile porfa"); // elige 1 banco -> account_sent
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    // Texto ambiguo -- no tiene ninguna palabra clave de límite/técnico, así
    // que debe caer al respaldo de IA (ver chat-brain-stub).
    chatBrainStub.queueIntent({ intent: "limit", followUpText: "Entendido, ¿cuánto puedes transferir?" });
    client.pushClientMessage("quisiera dividir esto de alguna forma");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    // El mensaje exacto varía al azar entre 2 variantes (ver pick() en
    // account_sent) -- ambas preguntan por el máximo que permite el banco.
    expect(client.getLastSentMessage()).toMatch(/(cuánto|cuál).*(banco|transferir)/i);

    const cs = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(cs.splitPaymentDeclared).toBe(true);
    expect(cs.state).toBe("awaiting_limit_amount");
  });
});
