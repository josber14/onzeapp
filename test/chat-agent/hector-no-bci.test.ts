// Prueba de regresión (ago 2026): el tenant de Hector no tiene cuenta BCI
// (solo Banco de Chile y Santander). Si un comprador pide pagar justo a esa
// cuenta, el bot debe avisar que no la tenemos, en vez de caer al flujo
// genérico de "no entendí". El tenant de ONZE (tenantId=1, sí tiene BCI) no
// debe verse afectado -- ahí BCI sigue siendo una cuenta normal más.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { createFakePrisma } = await import("../support/fake-prisma");
const { createFakeP2PClient } = await import("../support/fake-client");
const { makeOrder, makeAccount, makeDefaultAccounts } = await import("../support/fixtures");
const { chatBrainStub } = await import("../support/chat-brain-stub");

const fakePrisma = createFakePrisma();

vi.doMock("@/lib/prisma", () => ({ prisma: fakePrisma }));
vi.doMock("../../lib/p2p-bot/chat-lock", () => ({
  acquireChatLock: async () => true,
  releaseChatLock: async () => {},
}));
vi.doMock("../../lib/p2p-bot/chat-brain", () => chatBrainStub);

const { processOrder } = await import("../../lib/p2p-bot/chat-agent");

const ONZE_TENANT_ID = 1;
const HECTOR_TENANT_ID = 2;

// Hector: solo Banco de Chile y Santander, sin BCI.
fakePrisma.__seedAccounts([
  makeAccount({ tenantId: HECTOR_TENANT_ID, sortOrder: 0, accountInfo: { bank: "BANCO DE CHILE", holder: "Hector Velázquez", rut: "1-9", accountType: "Corriente", accountNumber: "111", email: "hector@example.com" } }),
  makeAccount({ tenantId: HECTOR_TENANT_ID, sortOrder: 1, accountInfo: { bank: "BANCO SANTANDER", holder: "Hector Velázquez", rut: "1-9", accountType: "Corriente", accountNumber: "222", email: "hector@example.com" } }),
]);
// ONZE: las 3 cuentas de siempre, incluyendo BCI.
fakePrisma.__seedAccounts(makeDefaultAccounts(ONZE_TENANT_ID));

beforeEach(() => {
  chatBrainStub.reset();
});

async function advanceToAskBank(tenantId: number, client: any, order: any) {
  await processOrder(tenantId, "binance", client, order, [], "ONZE"); // saluda, pregunta personal/empresa
  client.pushClientMessage("1"); // personal
  await processOrder(tenantId, "binance", client, order, [], "ONZE"); // pregunta a qué banco
}

describe("chat-agent: cuenta BCI no disponible (tenant de Hector)", () => {
  it("Hector: avisa que no tenemos BCI y ofrece Banco de Chile y Santander", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 100000 });

    await advanceToAskBank(HECTOR_TENANT_ID, client, order);

    client.pushClientMessage("puedo pagar a la cuenta bci?");
    await processOrder(HECTOR_TENANT_ID, "binance", client, order, [], "ONZE");

    const msg = client.getLastSentMessage()!;
    expect(msg).toMatch(/no contamos con cuenta bci/i);
    expect(msg).toMatch(/banco de chile/i);
    expect(msg).toMatch(/santander/i);

    // Sigue esperando que elija banco -- no se cerró ni se envió ninguna cuenta.
    const cs = fakePrisma.__getChatStateByOrder(HECTOR_TENANT_ID, "binance", order.orderNumber);
    expect(cs.state).toBe("awaiting_bank_choice");
  });

  it("ONZE: pedir BCI sigue funcionando normal (tiene esa cuenta)", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 100000 });

    await advanceToAskBank(ONZE_TENANT_ID, client, order);

    client.pushClientMessage("puedo pagar a la cuenta bci?");
    await processOrder(ONZE_TENANT_ID, "binance", client, order, [], "ONZE");

    const sent = client.getSentMessages().join("\n");
    expect(sent).not.toMatch(/no contamos con cuenta bci/i);
    expect(sent).toMatch(/bci/i);

    const cs = fakePrisma.__getChatStateByOrder(ONZE_TENANT_ID, "binance", order.orderNumber);
    expect(cs.state).toBe("account_sent");
  });
});
