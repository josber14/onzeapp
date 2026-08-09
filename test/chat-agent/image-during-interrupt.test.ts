// Prueba de regresión (ago 2026): caso real confirmado en vivo -- una orden
// de 1.000.000 CLP entró a "awaiting_problem" (el aviso automático de "tu
// orden está por vencer", que se dispara solo a los ~10 min de cualquier
// conversación activa) justo cuando el comprador mandó una captura de un
// ERROR del banco (límite para transferir a cuenta nueva). El bot solo leía
// imágenes en el estado exacto "account_sent", así que la ignoró por
// completo -- el operador tuvo que revisarla y responder a mano.
//
// Se escribe ANTES del arreglo para confirmar que reproduce el bug (falla
// contra el código actual), y debe quedar en verde después.
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

describe("chat-agent: lectura de imagen durante una interrupción temporal (awaiting_problem)", () => {
  it("lee y reacciona a una imagen de error del banco aunque el estado ya no sea account_sent", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 1000000, payTime: 15 });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // saludo
    client.pushClientMessage("1"); // personal
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE"); // awaiting_bank_choice
    client.pushClientMessage("banco de chile porfa"); // elige un banco -> account_sent
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    let cs = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(cs.state).toBe("account_sent");
    expect(Array.isArray(cs.chosenAccountIds) && cs.chosenAccountIds.length > 0).toBe(true);

    // Simula que ya pasaron ~11 de los 15 min para pagar -- cae dentro de la
    // ventana de 4.5 min antes del vencimiento, sin mandar ningún mensaje
    // nuevo del cliente, para que dispare el aviso automático puramente por
    // tiempo (igual que en producción).
    order.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    cs = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(cs.state).toBe("awaiting_problem");
    expect(client.getLastSentMessage()).toMatch(/por vencer/i);

    // El comprador manda la captura del error del banco JUSTO en esta
    // ventana -- antes del arreglo, el bot la ignoraba por completo.
    chatBrainStub.queueImage({ documentType: "payment_error" });
    client.pushClientImage("https://example.com/error-banco.jpg");
    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    expect(client.getLastSentMessage()).toMatch(/problema del banco tuyo/i);

    cs = fakePrisma.__getChatStateByOrder(TENANT_ID, "binance", order.orderNumber);
    expect(cs.transferFailCount).toBe(1);
  });
});
