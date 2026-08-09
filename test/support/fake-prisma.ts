// Reemplazo en memoria de @/lib/prisma para las pruebas del chatbot P2P
// (lib/p2p-bot/chat-agent.ts). NO es un mock genérico de Prisma -- solo
// implementa los métodos y formas de "where"/"data" que chat-agent.ts
// realmente usa hoy (confirmado leyendo el archivo, ago 2026):
//   p2PChatState:   create, findUnique, findMany, update
//   p2PBuyerIdentity: findUnique, findMany, upsert
//   p2PAccount:     findMany
// p2PBotLog nunca se implementa a propósito -- logMsg() en chat-agent.ts
// ya atrapa cualquier error al escribir el log, así que dejarlo undefined
// simplemente hace que los logs se ignoren en las pruebas, sin romper nada.
// El lock (ChatProcessingLock) NO se prueba acá -- ver test/support/mock-chat-lock.ts,
// que reemplaza directamente ./chat-lock en vez de simular la tabla.

let nextChatStateId = 1;

export function createFakePrisma() {
  const chatStates: any[] = [];
  const buyerIdentities: any[] = [];
  const accounts: any[] = [];

  function cloneRecord(r: any) {
    return r ? { ...r } : r;
  }

  const p2PChatState = {
    async create({ data }: any) {
      const now = new Date();
      const record = {
        id: nextChatStateId++,
        counterparty: null,
        isCompany: false,
        isReturning: false,
        previousBank: null,
        chosenBank: null,
        chosenAccountIds: null,
        pendingBankMenuIds: null,
        preInterruptState: null,
        erutRequested: false,
        erutReceived: false,
        retryCount: 0,
        transferFailCount: 0,
        expiryWarnedAt: null,
        receivedReceiptsClp: null,
        markPaidReminderSentAt: null,
        holderNameConcernAt: null,
        holderNameConfirmed: null,
        splitPaymentDeclared: false,
        partialAmount: null,
        totalAmount: null,
        realName: null,
        firstName: null,
        pendingFirstMsg: null,
        lastClientMsgAt: null,
        lastBotMsgAt: null,
        lastBotMsg: null,
        lastClientMsgSeen: null,
        appealAt: null,
        paidAt: null,
        completedAt: null,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      chatStates.push(record);
      return cloneRecord(record);
    },

    async findUnique({ where, select }: any) {
      let record: any;
      if (where.id != null) {
        record = chatStates.find((r) => r.id === where.id);
      } else if (where.tenantId_exchange_orderNumber) {
        const { tenantId, exchange, orderNumber } = where.tenantId_exchange_orderNumber;
        record = chatStates.find(
          (r) => r.tenantId === tenantId && r.exchange === exchange && r.orderNumber === orderNumber
        );
      } else {
        throw new Error(`fake-prisma: p2PChatState.findUnique no soporta este where: ${JSON.stringify(where)}`);
      }
      if (!record) return null;
      if (select) {
        const picked: any = {};
        for (const k of Object.keys(select)) picked[k] = record[k];
        return picked;
      }
      return cloneRecord(record);
    },

    async findMany({ where }: any = {}) {
      let results = chatStates;
      if (where) {
        results = results.filter((r) => {
          if (where.tenantId != null && r.tenantId !== where.tenantId) return false;
          if (where.exchange != null && r.exchange !== where.exchange) return false;
          if (where.state?.notIn && where.state.notIn.includes(r.state)) return false;
          if (where.NOT?.lastBotMsgAt === null && r.lastBotMsgAt === null) return false;
          return true;
        });
      }
      return results.map(cloneRecord);
    },

    async update({ where, data }: any) {
      const record = chatStates.find((r) => r.id === where.id);
      if (!record) throw new Error(`fake-prisma: p2PChatState.update no encontró id=${where.id}`);
      Object.assign(record, data, { updatedAt: new Date() });
      return cloneRecord(record);
    },
  };

  const p2PBuyerIdentity = {
    async findUnique({ where, select }: any) {
      const key = where.tenantId_exchange_label_nickName;
      const record = buyerIdentities.find(
        (r) => r.tenantId === key.tenantId && r.exchange === key.exchange && r.label === key.label && r.nickName === key.nickName
      );
      if (!record) return null;
      if (select) {
        const picked: any = {};
        for (const k of Object.keys(select)) picked[k] = record[k];
        return picked;
      }
      return cloneRecord(record);
    },

    async findMany({ where, select }: any) {
      let results = buyerIdentities.filter((r) => {
        if (where.tenantId != null && r.tenantId !== where.tenantId) return false;
        if (where.exchange != null && r.exchange !== where.exchange) return false;
        if (where.label != null && r.label !== where.label) return false;
        if (where.nickName?.startsWith != null && !String(r.nickName).startsWith(where.nickName.startsWith)) return false;
        return true;
      });
      if (select) {
        results = results.map((r) => {
          const picked: any = {};
          for (const k of Object.keys(select)) picked[k] = r[k];
          return picked;
        });
      }
      return results.map(cloneRecord);
    },

    async upsert({ where, update, create }: any) {
      const key = where.tenantId_exchange_label_nickName;
      let record = buyerIdentities.find(
        (r) => r.tenantId === key.tenantId && r.exchange === key.exchange && r.label === key.label && r.nickName === key.nickName
      );
      if (record) {
        const patch: any = { ...update };
        if (patch.orderCount?.increment != null) {
          patch.orderCount = (record.orderCount || 0) + patch.orderCount.increment;
        }
        Object.assign(record, patch, { updatedAt: new Date() });
      } else {
        record = { orderCount: 1, createdAt: new Date(), updatedAt: new Date(), ...create };
        buyerIdentities.push(record);
      }
      return cloneRecord(record);
    },
  };

  const p2PAccount = {
    async findMany({ where }: any) {
      return accounts
        .filter((a) => {
          if (where.tenantId != null && a.tenantId !== where.tenantId) return false;
          if (where.exchange != null && a.exchange !== where.exchange) return false;
          if (where.label != null && a.label !== where.label) return false;
          if (where.isActive != null && a.isActive !== where.isActive) return false;
          return true;
        })
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map(cloneRecord);
    },
  };

  return {
    p2PChatState,
    p2PBuyerIdentity,
    p2PAccount,
    // Helpers de prueba, no parte de la API real de Prisma -- para sembrar
    // datos y para inspeccionar el estado final de una conversación.
    __seedAccounts(rows: any[]) {
      accounts.push(...rows);
    },
    __getChatState(id: number) {
      return cloneRecord(chatStates.find((r) => r.id === id));
    },
    __getChatStateByOrder(tenantId: number, exchange: string, orderNumber: string) {
      return cloneRecord(
        chatStates.find((r) => r.tenantId === tenantId && r.exchange === exchange && r.orderNumber === orderNumber)
      );
    },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
