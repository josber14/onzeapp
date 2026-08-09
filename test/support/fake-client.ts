// Cliente P2P (Binance/Bybit) falso para pruebas -- implementa solo lo que
// lib/p2p-bot/chat-agent.ts realmente llama sobre `client`:
//   getChatMessages(orderNo)         -- leer el historial del chat
//   sendChatMessageWS(orderNo, msg)  -- mandar un mensaje (Binance)
//   sendChatMessage(orderNo, msg)    -- mandar un mensaje (Bybit)
// El historial se guarda en memoria y cada llamada de "cliente" (fixture)
// se agrega mediante pushClientMessage/pushClientImage; los mensajes que el
// bot manda quedan visibles en getSentMessages() para las aserciones.

export type FakeChatMessage = {
  id: string;
  type: string; // "text" | "system"
  content: string;
  self: boolean;
  createTime: number;
  imageUrl: string | null;
};

export function createFakeP2PClient(exchange: "binance" | "bybit") {
  const messages: FakeChatMessage[] = [];
  let nextId = 1;
  let clock = Date.now();

  function pushClientMessage(text: string) {
    clock += 1000;
    messages.push({ id: String(nextId++), type: "text", content: text, self: false, createTime: clock, imageUrl: null });
  }

  function pushClientImage(imageUrl: string) {
    clock += 1000;
    messages.push({ id: String(nextId++), type: "text", content: "", self: false, createTime: clock, imageUrl });
  }

  async function getChatMessages(_orderNo: string) {
    if (exchange === "binance") {
      return { data: messages.map((m) => ({ ...m })) };
    }
    // Forma real de la respuesta de Bybit (ver fetchMessages en chat-agent.ts):
    // result.result[], msgType (0=sistema), contentType ("str"/"pic"), createDate, userId.
    return {
      result: {
        result: messages.map((m) => ({
          id: m.id,
          msgType: m.type === "system" ? 0 : 1,
          contentType: m.imageUrl ? "pic" : "str",
          message: m.imageUrl || m.content,
          userId: m.self ? "us" : "them",
          createDate: String(m.createTime),
        })),
      },
    };
  }

  async function sendChatMessageWS(_orderNo: string, msg: string) {
    clock += 1000;
    messages.push({ id: String(nextId++), type: "text", content: msg, self: true, createTime: clock, imageUrl: null });
    return { ok: true };
  }

  async function sendChatMessage(_orderNo: string, msg: string) {
    clock += 1000;
    messages.push({ id: String(nextId++), type: "text", content: msg, self: true, createTime: clock, imageUrl: null });
    return { ok: true };
  }

  async function getOwnUserId() {
    return "us";
  }

  return {
    getChatMessages,
    sendChatMessageWS,
    sendChatMessage,
    getOwnUserId,
    pushClientMessage,
    pushClientImage,
    getSentMessages() {
      return messages.filter((m) => m.self).map((m) => m.content);
    },
    getLastSentMessage() {
      const sent = messages.filter((m) => m.self);
      return sent.length ? sent[sent.length - 1].content : null;
    },
  };
}

export type FakeP2PClient = ReturnType<typeof createFakeP2PClient>;
