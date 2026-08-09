// Prueba de regresión para el arreglo de "splitPaymentDeclared" (ago 2026):
// si el comprador NUNCA avisó que iba a pagar en partes y manda un
// comprobante por menos del total, el bot debe avisar de inmediato que
// falta dinero. Si SÍ avisó (nombra 2+ bancos), un monto parcial no debe
// generar ninguna alarma. Ver lib/p2p-bot/chat-agent.ts (missingAmountOnReceiptMsg).
//
// Usa vi.doMock (NO se adelanta/"hoistea" como vi.mock) para poder pasarle
// al mock una instancia de fake-prisma creada en el orden normal del
// archivo, sin pelear con el orden de hoisting de vitest.
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

// Las cuentas se siembran UNA sola vez para todo el archivo -- si cada
// prueba las vuelve a sembrar, quedan bancos duplicados (mismo banco, id
// distinto) y matchAllBanks() los cuenta como 2 bancos nombrados aunque el
// cliente haya nombrado uno solo, ensuciando la prueba.
fakePrisma.__seedAccounts(makeDefaultAccounts(TENANT_ID));

beforeEach(() => {
  chatBrainStub.reset();
});

describe("chat-agent: aviso de dinero faltante al recibir un comprobante", () => {
  it("NO avisa si el cliente ya declaró que pagaría en partes (nombró 2+ bancos)", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000 });

    // 1) Primer ciclo: sin mensajes todavía -> saluda y pregunta personal/empresa.
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    expect(client.getLastSentMessage()).toMatch(/personal o empresa/i);

    // 2) Cliente responde "1" (personal) -> pregunta a qué banco transferir.
    client.pushClientMessage("1");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    expect(client.getLastSentMessage()).toMatch(/¿A qué cuenta deseas transferir\?/i);

    // 3) Cliente nombra 2 bancos explícitamente -> debe marcar split declarado
    //    y mandar las 2 cuentas agrupadas.
    client.pushClientMessage("no me alcanza en una sola cuenta, puedo pagar con banco de chile y santander");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    const afterBanks = client.getLastSentMessage()!;
    expect(afterBanks).toMatch(/chile/i);
    expect(afterBanks).toMatch(/santander/i);

    const csAfterBanks = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(csAfterBanks.splitPaymentDeclared).toBe(true);

    // 4) Cliente manda un comprobante por MENOS del total (200.000 de 460.000)
    //    -> como ya declaró que paga en partes, NO debe alarmar, solo agradecer.
    chatBrainStub.queueImage({ documentType: "payment_receipt", amountClp: 200000 });
    client.pushClientImage("https://example.com/comprobante1.jpg");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const lastMsg = client.getLastSentMessage()!;
    expect(lastMsg).not.toMatch(/te faltaría transferir/i);
    expect(lastMsg).toMatch(/Recibí tu comprobante/i);
  });

  it("SÍ avisa si el cliente nunca avisó que pagaría en partes y el comprobante no alcanza", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000 });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    expect(client.getLastSentMessage()).toMatch(/personal o empresa/i);

    client.pushClientMessage("1");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    expect(client.getLastSentMessage()).toMatch(/¿A qué cuenta deseas transferir\?/i);

    // Elige UN solo banco puntual -- nunca menciona pagar en partes.
    // (los datos de la cuenta se mandan en varios mensajes seguidos, ver
    // sendAccountWithErutNote, así que se revisan TODOS los mandados en
    // este turno, no solo el último.)
    const sentBefore = client.getSentMessages().length;
    client.pushClientMessage("banco de chile porfa");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");
    const sentThisTurn = client.getSentMessages().slice(sentBefore);
    expect(sentThisTurn.some((m) => /BANCO DE CHILE/i.test(m))).toBe(true);

    const csAfterBank = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(csAfterBank.splitPaymentDeclared).toBe(false);

    // Manda un comprobante por menos del total, sin haber avisado nada de partes.
    chatBrainStub.queueImage({ documentType: "payment_receipt", amountClp: 200000 });
    client.pushClientImage("https://example.com/comprobante1.jpg");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const lastMsg = client.getLastSentMessage()!;
    expect(lastMsg).toMatch(/te faltaría transferir/i);
    expect(lastMsg).toMatch(/\$200\.000/);
    expect(lastMsg).toMatch(/\$460\.000/);
  });
});
