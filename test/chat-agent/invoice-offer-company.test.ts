// Prueba de regresión: cuando una cuenta EMPRESA marca "Pagado" y el pago
// está completo (sin aviso de underpayment), el bot debe mandar un segundo
// mensaje aparte ofreciendo la factura por WT (WhatsApp) -- pedido explícito
// del usuario (ago 2026). Cuentas Personal nunca deben recibir este mensaje.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { createFakePrisma } = await import("../support/fake-prisma");
const { createFakeP2PClient } = await import("../support/fake-client");
const { makeOrder } = await import("../support/fixtures");
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

beforeEach(() => {
  chatBrainStub.reset();
});

describe("chat-agent: oferta de factura por WT al marcar pagado (cuenta empresa)", () => {
  it("manda un segundo mensaje con el WT cuando es empresa y el pago está completo", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000, status: "paid", group: "paid" });

    await fakePrisma.p2PChatState.create({
      data: {
        tenantId: TENANT_ID,
        exchange: "binance",
        orderNumber: order.orderNumber,
        state: "account_sent",
        isCompany: true,
        chosenAccountIds: [1],
        totalAmount: order.amount,
      },
    });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const sent = client.getSentMessages();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]).toMatch(/recibimos tu aviso de pago/i);
    expect(sent[1]).toMatch(/WT 951333777/);
    expect(sent[1]).toMatch(/E-RUT/i);
  });

  it("NO manda la oferta de factura si es cuenta personal", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000, status: "paid", group: "paid" });

    await fakePrisma.p2PChatState.create({
      data: {
        tenantId: TENANT_ID,
        exchange: "binance",
        orderNumber: order.orderNumber,
        state: "account_sent",
        isCompany: false,
        chosenAccountIds: [1],
        totalAmount: order.amount,
      },
    });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const sent = client.getSentMessages();
    expect(sent.some((m) => m.includes("951333777"))).toBe(false);
  });

  it("NO manda la oferta de factura si el pago quedó incompleto (underpayment)", async () => {
    const client = createFakeP2PClient("binance");
    const order = makeOrder({ totalPrice: 460000, status: "paid", group: "paid" });

    await fakePrisma.p2PChatState.create({
      data: {
        tenantId: TENANT_ID,
        exchange: "binance",
        orderNumber: order.orderNumber,
        state: "account_sent",
        isCompany: true,
        chosenAccountIds: [1],
        totalAmount: order.amount,
        receivedReceiptsClp: 200000, // menos del total (460.000)
      },
    });

    await processOrder(TENANT_ID, "binance", client, order, [], "ONZE");

    const sent = client.getSentMessages();
    expect(sent.some((m) => m.includes("951333777"))).toBe(false);
    expect(sent[0]).toMatch(/menor al monto de la orden/i);
  });
});
