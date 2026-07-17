import { prisma } from "@/lib/prisma";
import type { ChatState, ChatMessage } from "./types";

const MAX_RETRIES = 3;

/* ─── Public entry point ─────────────────────────────────────── */

export async function processChats(
  tenantId: number,
  exchange: "binance" | "bybit",
  getClient: () => Promise<{ client: any }>,
  activeAds: any[],
  label = "ONZE"
) {
  const { client } = await getClient();

  let liveOrders: any[] = [];
  try {
    if (exchange === "binance") {
      const [sellRes, buyRes] = await Promise.all([
        client.getOrders({ page: 1, rows: 100, tradeType: "SELL" }),
        client.getOrders({ page: 1, rows: 100, tradeType: "BUY" }),
      ]);
      liveOrders = [...(sellRes?.data ?? []), ...(buyRes?.data ?? [])];
    } else {
      const res = await client.getOrders({ page: 1, size: 30 });
      liveOrders = res?.result?.items ?? [];
    }
  } catch (e: any) {
    await logMsg(tenantId, exchange, `Error obteniendo órdenes: ${e.message}`);
    return;
  }

  await logMsg(tenantId, exchange, `[Chat] órdenes devueltas: ${liveOrders.length}`);

  const seenOrders = new Set<string>();

  for (const rawOrder of liveOrders) {
    const orderNo = rawOrder.orderNumber ?? rawOrder.orderNo ?? rawOrder.id ?? "";
    if (!orderNo) continue;
    if (seenOrders.has(orderNo)) continue;
    seenOrders.add(orderNo);

    const order = normalizeOrder(rawOrder, exchange);
    await logMsg(tenantId, exchange, `[Chat] raw ${orderNo} status=${order.status} group=${order.group} rawStatus=${(rawOrder.orderStatus ?? rawOrder.status ?? '?')} tradeType=${rawOrder.tradeType || '?'} verified=${order.verified} rawVerify=${rawOrder.additionalKycVerify}`);
    if (order.group === "cancelled") continue;

    try {
      await processOrder(tenantId, exchange, client, order, activeAds, label);
    } catch (e: any) {
      await logMsg(tenantId, exchange, `Chat error ${orderNo}: ${e.message}`);
    }
  }

  // Process chat states that might not be in the live API results
  try {
    const pendingStates = await prisma.p2PChatState.findMany({
      where: {
        tenantId, exchange,
        state: { notIn: ["awaiting_verification", "completed", "closed"] },
        NOT: { lastBotMsgAt: null },
      },
    });
    await logMsg(tenantId, exchange, `[Chat] estados pendientes en DB: ${pendingStates.length}`);

    for (const ps of pendingStates) {
      if (seenOrders.has(ps.orderNumber)) continue; // Already processed in main loop

      // Try to fetch the actual order from the API to get real status
      try {
        const [sellRes, buyRes] = await Promise.all([
          client.getOrders({ page: 1, rows: 100, tradeType: "SELL" }),
          client.getOrders({ page: 1, rows: 100, tradeType: "BUY" }),
        ]);
        const allOrders = [...(sellRes?.data ?? []), ...(buyRes?.data ?? [])];
        const rawOrder = allOrders.find((o: any) => (o.orderNumber ?? o.orderNo ?? o.id) === ps.orderNumber);
        if (rawOrder) {
          const order = normalizeOrder(rawOrder, "binance");
          await processOrder(tenantId, exchange, client, order, activeAds, label);
          continue;
        }
      } catch {}

      // Fallback: use stored data but with a longer payTime for 5-min warning
      await processOrder(tenantId, exchange, client, {
        orderNumber: ps.orderNumber,
        counterparty: ps.counterparty || "",
        payTime: 15,
        createdAt: ps.createdAt?.toISOString() || new Date().toISOString(),
        executedAt: new Date().toISOString(),
        amount: ps.totalAmount || 0,
        status: "pending",
        group: "pending",
        tradeType: "SELL",
        asset: "USDT",
        fiat: "CLP",
        unitPrice: 0,
        totalPrice: 0,
        verified: true,
      }, activeAds, label);
    }
  } catch (e: any) {
    await logMsg(tenantId, exchange, `[Chat] error estados pendientes: ${e.message}`);
  }
}

/* ─── Process a single order ──────────────────────────────────── */

async function processOrder(
  tenantId: number,
  exchange: "binance" | "bybit",
  client: any,
  order: any,
  activeAds: any[],
  label = "ONZE"
) {
  const orderNo = order.orderNumber;

  // Tiempo real de pago del anuncio (para el aviso de "por vencer") — Binance
  // no lo manda en la orden, así que se toma del anuncio real que generó esta
  // orden (matcheado por advNo, ver findMatchingAd). Si no se encuentra el
  // anuncio, se mantiene el default de 15 min de normalizeOrder.
  const matchedAd = findMatchingAd(activeAds, order);
  if (matchedAd?.paymentPeriod) {
    order.payTime = matchedAd.paymentPeriod;
  }

  const isCompleted = order.group === "completed";
  const isCancelled = order.group === "cancelled" && order.status !== "pending";
  const isPaid = order.status === "paid" || order.group === "paid";
  const isPending = order.status === "pending" || order.group === "pending";
  const isAppealed = order.status === "appealed" || order.group === "appealed";

  let cs = await prisma.p2PChatState.findUnique({
    where: { tenantId_exchange_orderNumber: { tenantId, exchange, orderNumber: orderNo } },
  });

  await logMsg(tenantId, exchange, `[Chat] processOrder ${orderNo} status=${order.status} group=${order.group} verified=${order.verified} cs=${cs ? cs.state : 'null'}`);

  if (!cs) {
    if (!isPending && !isPaid && !isCompleted) return;

    // Never message completed orders that have no chat state (completed before bot activated)
    if (isCompleted) return;

    // Skip orders from previous days that don't have a chat state yet
    if (order.createdAt) {
      const orderDate = new Date(order.createdAt);
      const today = new Date();
      const isToday = orderDate.getDate() === today.getDate() &&
        orderDate.getMonth() === today.getMonth() &&
        orderDate.getFullYear() === today.getFullYear();
      if (!isToday) {
        await logMsg(tenantId, exchange, `[Chat] ${orderNo}: orden de otro día, ignorando`);
        return;
      }
    }

    cs = await prisma.p2PChatState.create({
      data: {
        tenantId, exchange, orderNumber: orderNo,
        counterparty: order.counterparty || null,
        state: "awaiting_verification",
        totalAmount: order.amount || 0,
        verifiedAt: order.verified ? new Date() : null,
      },
    });
  }

  // If order is completed, send final message and mark done
  if (isCompleted) {
    // Double-check in DB to avoid duplicates from race conditions
    const current = await prisma.p2PChatState.findUnique({ where: { id: cs.id }, select: { state: true } });
    if (current?.state === "completed" || current?.state === "closed") return;
    const msg = await buildCompletionMessage(cs, tenantId, exchange);
    await sendAndTrack(client, exchange, order.orderNumber, cs, msg, order.createdAt ? new Date(order.createdAt).getTime() : undefined);
    await updateState(cs.id, "completed", { completedAt: new Date() });
    return;
  }

  // If order is cancelled while in mid-conversation, close it
  if (isCancelled && cs.state !== "completed" && cs.state !== "closed" && cs.state !== "awaiting_verification") {
    await updateState(cs.id, "closed");
    return;
  }

  // If order is appealed, notify and close
  if (isAppealed && cs.state !== "completed" && cs.state !== "closed") {
    if (cs.state !== "awaiting_verification") {
      await sendAndTrack(client, exchange, order.orderNumber, cs,
        "⚠️ El comprador ha abierto una apelación en la orden. Un asesor revisará el caso a la brevedad."
      );
    }
    await updateState(cs.id, "closed", { appealAt: new Date() });
    return;
  }

  if (!isPending && !isPaid && !isCompleted && !isAppealed) return;

  // Fetch chat messages for response handling
  const msgs = await fetchMessages(exchange, client, orderNo, order.createdAt);
  const sinceTime = cs.lastClientMsgAt ? new Date(cs.lastClientMsgAt).getTime() : null;
  const lastClientMsg = findLastClientMsg(msgs, sinceTime);

  await logMsg(tenantId, exchange, `[Chat] processOrder ${orderNo} state=${cs.state} pending=${isPending} paid=${isPaid} msgs=${msgs.length} lastClientMsg=${lastClientMsg?.content?.slice(0, 30)?.replace(/\n/g,'|') || 'null'}`);

  if (cs.state === "awaiting_verification") {
    if (order.verified) {
      await handleVerified(tenantId, exchange, client, cs, order, activeAds, label);
    }
    return;
  }

  // Handle paid status BEFORE processing client messages
  if (isPaid) {
    if (cs.state === "account_sent") {
      await sendAndTrack(client, exchange, orderNo, cs, paymentAckMessage());
      await updateState(cs.id, "payment_made", { paidAt: new Date() });
      return;
    }
    if (!["account_sent", "payment_made", "awaiting_comprobant", "completed", "closed", "awaiting_verification"].includes(cs.state)) {
      await sendAndTrack(client, exchange, orderNo, cs, paymentAckMessage());
      await updateState(cs.id, "payment_made", { paidAt: new Date() });
      return;
    }
  }

  // Handle client response for any active conversation state
  if (lastClientMsg && cs.state !== "completed" && cs.state !== "closed" && cs.state !== "payment_made") {
    const textContent = lastClientMsg.content?.trim() || "";
    if (!textContent && lastClientMsg.imageUrl) {
      if (!isPaid) return;
    } else {
      await handleClientResponse(tenantId, exchange, client, cs, order, lastClientMsg.content, activeAds, label);
      if (lastClientMsg.content || lastClientMsg.imageUrl) {
        const msgTime = lastClientMsg.createTime > 0 ? new Date(lastClientMsg.createTime) : new Date();
        await prisma.p2PChatState.update({
          where: { id: cs.id },
          data: { lastClientMsgAt: msgTime },
        });
        cs.lastClientMsgAt = msgTime;
      }
      return;
    }
  }

  // 5-minute warning for any active state where buyer hasn't paid yet
  if (isPending && !order.verified && cs.state !== "awaiting_verification" && cs.state !== "completed" && cs.state !== "closed" && !cs.verifiedAt) {
    const payWindow = Number(order.payTime ?? 15) * 60 * 1000;
    const createdAt = new Date(order.createdAt || order.executedAt || Date.now()).getTime();
    const expiresAt = createdAt + payWindow;
    const fiveMinBefore = expiresAt - 5 * 60 * 1000;

    if (Date.now() >= fiveMinBefore && Date.now() < expiresAt) {
      await sendAndTrack(client, exchange, orderNo, cs,
        "Hola, tu orden está por vencer. ¿Necesitas más tiempo para completar el pago o estás teniendo problemas?\n  1) Más tiempo\n  2) Problemas\n\nResponde 1 o 2."
      );
      await updateState(cs.id, "awaiting_problem");
    }
    return;
  }

  // Monitor payment_made: ask for receipt after 1 minute.
  // hasComprobant revisa TODA la conversación de esta orden (sin filtro de
  // tiempo) — se probó comparar contra cs.paidAt, pero ni siquiera eso
  // alcanza: el comprador manda la imagen, marca "pagado" y todo pasa casi
  // junto, y nuestro propio cs.paidAt (que sale de sondear el estado de la
  // orden vía API) puede quedar registrado DESPUÉS de que la imagen ya había
  // llegado. Como cada orden tiene su propio chat, no hay riesgo real de que
  // una imagen "vieja" de otra transacción se confunda con esta.
  if (cs.state === "payment_made") {
    const paidAtMs = cs.paidAt ? new Date(cs.paidAt).getTime() : 0;
    const oneMinAfter = paidAtMs + 60 * 1000;
    if (Date.now() >= oneMinAfter && !hasComprobant(msgs, null)) {
      let extra = "";
      if (cs.isCompany && !cs.erutReceived) {
        extra = "\n\nRecuerda que al ser cuenta empresa también necesitamos el ERUT para validar la titularidad y emitir la factura.";
      }
      await sendAndTrack(client, exchange, orderNo, cs,
        "Hola, ¿nos puedes enviar el comprobante del pago para agilizar la validación?" + extra
      );
      await updateState(cs.id, "awaiting_comprobant");
    }
    return;
  }

  // Check if receipt was sent while in awaiting_comprobant
  if (cs.state === "awaiting_comprobant" && isPaid) {
    if (hasComprobant(msgs, null)) {
      await updateState(cs.id, "payment_made");
    }
    return;
  }
}

/* ─── Handle verification — simplified flow ──────────────────── */

export async function handleVerified(
  tenantId: number,
  exchange: "binance" | "bybit",
  client: any,
  cs: any,
  order: any,
  activeAds: any[],
  label = "ONZE"
) {
  const createdAtTs = order.createdAt ? new Date(order.createdAt).getTime() : undefined;

  const current = await prisma.p2PChatState.findUnique({ where: { id: cs.id }, select: { state: true } });
  if (current?.state === "completed" || current?.state === "closed") return;

  await logMsg(tenantId, exchange, `[Chat] handleVerified: iniciando para ${order.orderNumber}`);

  const history = order.counterparty ? await getBuyerHistory(tenantId, exchange, order.counterparty) : null;
  const isReturning = !!history;
  const greeting = buildInitialGreeting(isReturning, order.counterparty);

  const sent = await sendAndTrack(client, exchange, order.orderNumber, cs,
    greeting,
    createdAtTs
  );
  if (sent) await updateState(cs.id, "awaiting_account_type", { isCompany: false, isReturning });
}

/* ─── Handle client response ──────────────────────────────────── */

async function handleClientResponse(
  tenantId: number,
  exchange: "binance" | "bybit",
  client: any,
  cs: any,
  order: any,
  text: string,
  activeAds: any[],
  label = "ONZE"
) {
  const textLower = text.toLowerCase().trim();
  let retryCount = cs.retryCount || 0;

  switch (cs.state) {
    case "awaiting_account_type": {
      const opt = matchOption(textLower, 2);
      if (opt === 2 || textLower.includes("empresa") || matchERUT(textLower)) {
        // Company flow
        const ad = findMatchingAd(activeAds, order);
        const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const accounts = pickDefaultAccountsPerBank(allAccounts);
        const erutNote = "Al realizar el pago, por favor adjunta el ERUT junto con el comprobante para emitir la factura.";

        // Check if returning customer
        const history = cs.counterparty ? await getBuyerHistory(tenantId, exchange, cs.counterparty) : null;
        const previousAccountStillAvailable = history && allAccounts.some((a: any) => a.id === history.accountId);

        if (previousAccountStillAvailable) {
          const msg = erutNote + "\n\n" +
            `¿Quieres que te envíe la cuenta de ${history.bank} de nuevo, o vas a transferir a la misma cuenta donde ya pagaste antes?\n  1) Envíame la cuenta\n  2) Voy a transferir a la misma cuenta\n\nResponde 1 o 2.`;
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
          await updateState(cs.id, "awaiting_previous_account", { isCompany: true, isReturning: true, erutRequested: true, previousBank: history.bank, chosenAccountIds: [history.accountId], retryCount: 0 });
        } else if (accounts.length === 1) {
          const acct = accounts[0];
          const msg = erutNote + "\n\nTe envío la cuenta para que procedas con el pago:\n\n" +
            formatSingleAccount(acct) +
            "\n\nCuando realices el pago:\n- Marca \"Pagado\" en la orden\n- Envía el comprobante aquí en el chat";
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
          await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
        } else {
          const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
          const msg = erutNote + "\n\n¿A qué cuenta deseas transferir?\n" + choices;
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
          await updateState(cs.id, "awaiting_bank_choice", { isCompany: true, erutRequested: true, retryCount: 0 });
        }
      } else if (opt === 1 || textLower.includes("personal")) {
        // Personal flow
        const ad = findMatchingAd(activeAds, order);
        const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const accounts = pickDefaultAccountsPerBank(allAccounts);

        // Check if returning customer
        const history = cs.counterparty ? await getBuyerHistory(tenantId, exchange, cs.counterparty) : null;
        const previousAccountStillAvailable = history && allAccounts.some((a: any) => a.id === history.accountId);

        if (previousAccountStillAvailable) {
          const msg = `¿Quieres que te envíe la cuenta de ${history.bank} de nuevo, o vas a transferir a la misma cuenta donde ya pagaste antes?\n  1) Envíame la cuenta\n  2) Voy a transferir a la misma cuenta\n\nResponde 1 o 2.`;
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
          await updateState(cs.id, "awaiting_previous_account", { isReturning: true, previousBank: history.bank, chosenAccountIds: [history.accountId], retryCount: 0 });
        } else if (accounts.length === 1) {
          // New customer, single account: send directly
          const acct = accounts[0];
          const msg = "Te envío la cuenta para que procedas con el pago:\n\n" +
            formatSingleAccount(acct) +
            "\n\nCuando realices el pago:\n- Marca \"Pagado\" en la orden\n- Envía el comprobante aquí en el chat";
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
          await updateState(cs.id, "account_sent", { chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
        } else {
          // New customer, multiple accounts: ask
          const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            `¿A qué cuenta deseas transferir?\n${choices}\n\nTambién puedes escribir el nombre del banco.`
          );
          await updateState(cs.id, "awaiting_bank_choice", { isCompany: false, retryCount: 0 });
        }
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "No entendí. ¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2."
          );
          await updateState(cs.id, "awaiting_account_type", { retryCount });
        }
      }
      break;
    }

    case "awaiting_previous_account": {
      const opt = matchOption(textLower, 2);
      if (opt === 1) {
        // Send account again — puede ser la cuenta oculta (vista) si esa fue
        // la elegida antes, por eso incluye ocultas.
        const ad = findMatchingAd(activeAds, order);
        const accounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const acct = accounts.find((a: any) => a.id === (cs.chosenAccountIds?.[0] || 0)) || accounts[0];
        await sendAccountWithErutNote(tenantId, exchange, client, order, cs, acct);
        await updateState(cs.id, "account_sent", { chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
      } else if (opt === 2) {
        // Will pay to the same account
        let msg = "Perfecto, cuando realices el pago marca \"Pagado\" en la orden y envía el comprobante por aquí.";
        if (cs.isCompany) {
          msg += "\n\nRecuerda adjuntar el ERUT junto con el comprobante para emitir la factura.";
        }
        await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
        await updateState(cs.id, "account_sent", { retryCount: 0 });
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            `No entendí. ¿Quieres que te envíe la cuenta de ${cs.previousBank || "Banco Estado"} de nuevo, o vas a transferir a la misma cuenta donde ya pagaste antes?\n  1) Envíame la cuenta\n  2) Voy a transferir a la misma cuenta\n\nResponde 1 o 2.`
          );
          await updateState(cs.id, "awaiting_previous_account", { retryCount });
        }
      }
      break;
    }

    case "awaiting_single_confirm": {
      // Legacy — should not be reached with new flow, but keep for safety
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
        await updateState(cs.id, "closed", { retryCount });
      } else {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "No entendí. ¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa"
        );
        await updateState(cs.id, "awaiting_account_type", { retryCount });
      }
      break;
    }

    case "awaiting_bank_choice": {
      // Check for company/factura request
      if (matchCompanyType(textLower) === true || matchERUT(textLower)) {
        const s = await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Entendido. ¿La transferencia es desde cuenta empresa o personal?\n  1) Empresa\n  2) Personal"
        );
        if (s) await updateState(cs.id, "awaiting_company_type", { retryCount: 0 });
        break;
      }
      const ad = findMatchingAd(activeAds, order);
      const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
      const accounts = pickDefaultAccountsPerBank(allAccounts);
      const opt = matchOption(textLower, accounts.length);
      // El número del menú solo elige entre las cuentas por defecto (nunca la
      // vista); pero si escribe texto libre, matchBank sí puede reconocer una
      // cuenta oculta (ej. "vista", o los últimos dígitos) si la pide directo.
      const chosen = opt ? accounts[opt - 1] : matchBank(textLower, allAccounts);

      if (chosen) {
        await sendAccountWithErutNote(tenantId, exchange, client, order, cs, chosen);
        await updateState(cs.id, "account_sent", { chosenBank: chosen.bank, chosenAccountIds: [chosen.id], retryCount: 0 });
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            `No entendí. Por favor elige el banco para tu depósito:\n${choices}\n\nResponde el número o escribe el nombre del banco.`
          );
          await updateState(cs.id, "awaiting_bank_choice", { retryCount });
        }
      }
      break;
    }

    // Generic account_sent handler: monitor for problems, ERUT, third-party, etc.
    case "account_sent": {
      if (matchThirdParty(textLower)) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Lo siento, la transferencia debe ser desde una cuenta a nombre del titular de la orden. No aceptamos depósitos de terceros.\n\n¿Tienes otra forma de realizar el pago?"
        );
      } else if (matchERUT(textLower) || matchCompanyType(textLower) === true) {
        if (cs.isCompany || matchCompanyType(textLower) === true) {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "Entendido, es cuenta empresa. Necesitamos que nos envíes el ERUT para validar la titularidad y emitir la factura correspondiente.\n\n¿Puedes enviarlo por aquí?"
          );
          await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, retryCount: 0 });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "Entendido. Si la transferencia es desde cuenta empresa, necesitamos el ERUT. ¿Es tu caso?\n  1) Sí, es empresa\n  2) No, es personal"
          );
          await updateState(cs.id, "awaiting_company_type", { retryCount: 0 });
        }
      } else {
        // Acá es exactamente el caso "el comprador pregunta directo por una
        // cuenta específica" — incluye las ocultas (vista) a propósito.
        const ad = findMatchingAd(activeAds, order);
        const accounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const chosen = matchBank(textLower, accounts);
        const problemType = matchProblemType(textLower);
        if (chosen) {
          await sendAccountWithErutNote(tenantId, exchange, client, order, cs, chosen);
          await updateState(cs.id, "account_sent", { chosenBank: chosen.bank, chosenAccountIds: [chosen.id], retryCount: 0 });
        } else if (problemType === "limit") {
          // Pregunta proactiva por el límite de su banco (ej: "solo me deja
          // 500mil, ¿puedo hacer 2 pagos?") — NO es un reclamo de que la
          // transferencia falló, así que no debe caer en handleTransferFails
          // (eso solo ofrece OTRA cuenta, no responde la pregunta real).
          const amount = extractAmount(textLower);
          if (amount > 0 && cs.totalAmount) {
            await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
          } else {
            await sendAndTrack(client, exchange, order.orderNumber, cs,
              pick([
                "Sí, puedes hacer el pago en 2 partes sin problema. ¿Cuánto te permite transferir tu banco por vez?",
                "Claro, no hay problema en dividirlo en 2 pagos. ¿Cuál es el máximo que te deja transferir tu banco?",
              ])
            );
            await updateState(cs.id, "awaiting_limit_amount", { retryCount: 0 });
          }
        } else if (problemType === "not_working" || textLower.includes("no me")) {
          await handleTransferFails(tenantId, exchange, client, order, cs, activeAds, textLower, label);
        }
      }
      break;
    }

    case "awaiting_company_type": {
      const opt = matchOption(textLower, 2);
      let companyType = opt === 1 ? true : opt === 2 ? false : null;
      if (companyType === null) companyType = matchCompanyType(textLower);
      if (companyType === true) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Entendido. Por favor adjunta el ERUT de la empresa para validar la información y emitir la factura.\n\nLos datos de la cuenta ya están disponibles más arriba."
        );
        await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, retryCount: 0 });
      } else if (companyType === false) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Perfecto, es cuenta personal. Los datos de la cuenta ya están disponibles más arriba."
        );
        await updateState(cs.id, "account_sent", { isCompany: false, retryCount: 0 });
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "No entendí. ¿La transferencia es desde cuenta empresa o personal?\n  1) Empresa\n  2) Personal\n\nResponde 1 o 2."
          );
          await updateState(cs.id, "awaiting_company_type", { retryCount });
        }
      }
      break;
    }

    case "awaiting_problem": {
      const opt = matchOption(textLower, 2);
      if (opt === 1) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Perfecto, solicitaré una extensión de tiempo. Cuando realices el pago marca \"Pagado\" y envíanos el comprobante."
        );
        await updateState(cs.id, "account_sent", { retryCount: 0 });
      } else if (opt === 2 || matchProblemType(textLower) !== null) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "¿Qué tipo de problema?\n  1) Límite diario\n  2) No me funciona el banco\n\nResponde 1 o 2."
        );
        await updateState(cs.id, "awaiting_problem_type", { retryCount: 0 });
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "No entendí. ¿Necesitas más tiempo o estás teniendo problemas?\n  1) Más tiempo\n  2) Problemas\n\nResponde 1 o 2."
          );
          await updateState(cs.id, "awaiting_problem", { retryCount });
        }
      }
      break;
    }

    case "awaiting_problem_type": {
      const opt = matchOption(textLower, 2);
      if (opt === 1 || textLower.includes("límite") || textLower.includes("limite")) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "¿Cuál es el límite diario de tu banco para transferencias?"
        );
        await updateState(cs.id, "awaiting_limit_amount", { retryCount: 0 });
      } else if (opt === 2 || textLower.includes("no funciona") || textLower.includes("no me funciona") || textLower.includes("banco")) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Lamentamos el problema con tu banco. Cuando soluciones y estés listo, vuelve a tomar la orden. ¡Te esperamos! 👍🏻"
        );
        await updateState(cs.id, "closed");
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "No entendí. ¿Qué tipo de problema?\n  1) Límite diario\n  2) No me funciona el banco\n\nResponde 1 o 2."
          );
          await updateState(cs.id, "awaiting_problem_type", { retryCount });
        }
      }
      break;
    }

    case "awaiting_limit_amount": {
      const amount = extractAmount(textLower);
      if (amount > 0 && cs.totalAmount) {
        await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendAndTrack(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor.");
          await updateState(cs.id, "closed", { retryCount });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "No entendí el monto. ¿Cuánto te permite transferir tu banco? (ej: 150000)"
          );
          await updateState(cs.id, "awaiting_limit_amount", { retryCount });
        }
      }
      break;
    }

    default:
      break;
  }
}

/* ─── Transfer fails (3 attempts then close) ─────────────────── */

async function handleTransferFails(
  tenantId: number,
  exchange: string,
  client: any,
  order: any,
  cs: any,
  activeAds: any[],
  _text: string,
  label = "ONZE"
) {
  const fails = (cs.transferFailCount || 0) + 1;

  if (fails >= 3) {
    await sendAndTrack(client, exchange, order.orderNumber, cs,
      "Puede ser un problema con tu banco. Lamentablemente no podemos extender más el tiempo. Intenta más tarde cuando se resuelva.\n\nQuedamos atentos para la próxima."
    );
    await updateState(cs.id, "closed", { transferFailCount: 0 });
    return;
  }

  const ad = findMatchingAd(activeAds, order);
  const accounts = await getAccountsForAd(tenantId, exchange as any, ad, label);
  const alreadySentIds = new Set((cs.chosenAccountIds as number[]) || []);
  const remaining = accounts.filter((a: any) => !alreadySentIds.has(a.id));

  if (remaining.length > 0) {
    const next = remaining[0];
    await sendAndTrack(client, exchange, order.orderNumber, cs,
      "Aquí tienes otra cuenta para intentar:\n\n" +
      formatSingleAccount(next) +
      "\n\nIntenta con esta y me avisas."
    );
    await updateState(cs.id, "account_sent", {
      chosenAccountIds: [...alreadySentIds, next.id],
      chosenBank: next.bank,
      retryCount: 0,
      transferFailCount: fails,
    });
  } else {
    await sendAndTrack(client, exchange, order.orderNumber, cs,
      "Puede ser un problema con tu banco. Lamentablemente no podemos extender más el tiempo. Intenta más tarde cuando se resuelva.\n\nQuedamos atentos para la próxima."
    );
    await updateState(cs.id, "closed", { transferFailCount: 0 });
  }
}

/* ─── Completion (called externally from engine after human releases) ─── */

export async function completeOrderChat(
  tenantId: number,
  exchange: "binance" | "bybit",
  orderNumber: string,
  client: any
) {
  const cs = await prisma.p2PChatState.findUnique({
    where: { tenantId_exchange_orderNumber: { tenantId, exchange, orderNumber } },
  });
  if (!cs) return;

  const msg = await buildCompletionMessage(cs, tenantId, exchange);

  if (exchange === "binance") {
    await sendAndTrack(client, exchange, orderNumber, cs, msg);
  } else {
    await client.sendChatMessage(orderNumber, msg);
  }

  await updateState(cs.id, "completed", { completedAt: new Date() });
}

/* ─── Helpers ─────────────────────────────────────────────────── */

async function sendAccountWithErutNote(
  tenantId: number,
  exchange: string,
  client: any,
  order: any,
  cs: any,
  acct: any
) {
  const erutNote = cs.isCompany
    ? "\n\nAl ser cuenta empresa, necesitamos el ERUT para validar la titularidad y emitir la factura. Por favor adjúntalo cuando puedas."
    : "";
  const msg = "Listo. Estos son los datos para depositar:\n\n" +
    formatSingleAccount(acct) +
    erutNote +
    "\n\nCuando realices el pago:\n- Marca \"Pagado\" en la orden\n- Envía el comprobante aquí en el chat";
  await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
}

export function normalizeOrder(raw: any, exchange: string) {
  const rawStatus = (raw.orderStatus ?? raw.status ?? "").toString();
  let status = "pending";
  if (["COMPLETED", "50", "completed"].includes(rawStatus)) status = "completed";
  else if (["CANCELLED", "CANCELLED_BY_SYSTEM", "60", "cancelled"].includes(rawStatus)) status = "cancelled";
  else if (["PAID", "BUYER_PAYED", "30"].includes(rawStatus)) status = "paid";
  else if (["APPEALED", "40"].includes(rawStatus)) status = "appealed";

  const group = status === "paid" ? "paid" : status === "appealed" ? "appealed" : status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "pending";
  const rawVerified = raw.additionalKycVerify;
  const verified = rawVerified === 2 || rawVerified === true || rawVerified === "2" || rawVerified === "true";

  return {
    orderNumber: raw.orderNumber ?? raw.orderNo ?? raw.id ?? raw.orderId ?? "",
    advNo: raw.advNo ?? raw.advOrderNo ?? "",
    tradeType: raw.tradeType === "BUY" || raw.side === 0 ? "BUY" : "SELL",
    asset: raw.asset ?? raw.tokenId ?? "USDT",
    fiat: raw.fiat ?? raw.currencyId ?? "CLP",
    amount: Number(raw.amount ?? raw.totalQuantity ?? 0),
    unitPrice: Number(raw.price ?? raw.unitPrice ?? 0),
    totalPrice: Number(raw.totalPrice ?? 0),
    status,
    group,
    counterparty: raw.advertiser?.nickName ?? raw.nickName ?? raw.counterPartNickName ?? raw.counterpartyNickName ?? raw.targetNickName ?? "",
    createdAt: raw.createTime ?? raw.createdAt ?? raw.executedAt ?? new Date().toISOString(),
    executedAt: raw.executedAt ?? raw.createTime ?? new Date().toISOString(),
    // Binance no devuelve el tiempo de pago en la orden (confirmado en vivo,
    // jul 2026) — este default de 15 solo aplica si no logramos calzar la
    // orden con uno de nuestros anuncios reales (ver findMatchingAd, que usa
    // advNo para encontrar el anuncio y tomar su paymentPeriod real).
    payTime: Number(raw.payTime ?? raw.paymentTime ?? raw.payWindow ?? 15),
    verified,
  };
}

async function fetchMessages(exchange: string, client: any, orderNo: string, _orderCreatedAt?: string): Promise<ChatMessage[]> {
  // REST API: fast (~1s), returns real user messages (type: "text") and system (type: "system")
  try {
    let raw: any;
    if (exchange === "binance") {
      const res = await client.getChatMessages(orderNo);
      raw = res?.data ?? [];
    } else {
      const res = await client.getChatMessages(orderNo);
      raw = res?.result?.items ?? [];
    }
    return raw.map((m: any) => ({
      id: String(m.id ?? m.uuid ?? ""),
      type: m.type ?? "user",
      content: m.content ?? "",
      self: !!m.self,
      createTime: Number(m.createTime ?? 0),
      imageUrl: m.imageUrl ?? m.thumbnailUrl ?? null,
    })).sort((a: any, b: any) => a.createTime - b.createTime);
  } catch {
    return [];
  }
}

function findLastClientMsg(msgs: ChatMessage[], sinceTime?: number | null): ChatMessage | null {
  // messages are sorted oldest-first; return first one newer than sinceTime
  for (const m of msgs) {
    if (m.self || m.type === "system") continue;
    if (!m.content.trim() && !m.imageUrl) continue;
    if (sinceTime !== null && sinceTime !== undefined && m.createTime <= sinceTime) continue;
    return m;
  }
  return null;
}

function hasComprobant(msgs: ChatMessage[], since: Date | string | null): boolean {
  const sinceTime = since ? new Date(since).getTime() : 0;
  return msgs.some(m => !m.self && m.createTime > sinceTime && (m.imageUrl || m.content.toLowerCase().includes("comprobant")));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Delay antes de contestar para que no se sienta como una respuesta
// instantánea de máquina — una persona real tarda en leer y escribir.
async function humanDelay(): Promise<void> {
  const ms = 2000 + Math.floor(Math.random() * 3000); // 2-5s
  await new Promise(r => setTimeout(r, ms));
}

async function sendAndTrack(client: any, exchange: string, orderNo: string, cs: any, msg: string, createdAt?: number): Promise<boolean> {
  try {
    await humanDelay();
    let sent = false;
    if (exchange === "binance") {
      // Envío por WebSocket oficial (API Key, sin cookies ni navegador) —
      // confirmado funcionando con soporte de Binance jul 2026, ver
      // binance-adapter.ts sendChatMessageWS(). Reemplaza Playwright/BAPI.
      try {
        const wsRes = await client.sendChatMessageWS(orderNo, msg);
        sent = wsRes.ok;
        if (!sent) {
          await logMsg(cs.tenantId, exchange, `WS chat falló: ${wsRes.error}`);
        }
      } catch (wsErr: any) {
        await logMsg(cs.tenantId, exchange, `WS chat err: ${wsErr.message}`);
      }
    } else {
      await client.sendChatMessage(orderNo, msg);
      sent = true;
    }
    if (sent) {
      await prisma.p2PChatState.update({
        where: { id: cs.id },
        data: { lastBotMsgAt: new Date(), lastBotMsg: msg.slice(0, 500) },
      });
    }
    return sent;
  } catch (e: any) {
    await logMsg(cs.tenantId, exchange, `sendMsg ${orderNo}: ${e.message}`);
    return false;
  }
}

async function updateState(id: number, state: ChatState, extra: Record<string, any> = {}) {
  await prisma.p2PChatState.update({ where: { id }, data: { state, ...extra, updatedAt: new Date() } });
}

function matchOption(text: string, max: number): number | null {
  const num = parseInt(text);
  if (!isNaN(num) && num >= 1 && num <= max) return num;
  if (/^\d+$/.test(text)) return null;
  if (text.startsWith("sí") || text.startsWith("si ") || text === "si" || text.startsWith("yes")) return 1;
  if (text.startsWith("no") || text.startsWith("2")) return 2;
  if (max >= 3 && (text.startsWith("3") || text.includes("tercer"))) return 3;
  return null;
}

const ACCOUNT_TYPE_KEYWORDS = ["vista", "corriente", "ahorro", "rut"];

// Reconoce cuando el comprador pregunta por una cuenta específica en texto
// libre en vez de responder con el número del menú — ej: "¿te puedo
// transferir a la cuenta vista que ya tengo agregada?" o "¿a la que termina
// en 8502?". Solo devuelve una cuenta cuando el match es inequívoco (una
// sola cuenta califica); si hay ambigüedad, devuelve null y se deja que la
// conversación siga por el camino normal (listar opciones) en vez de
// arriesgarse a mandar los datos de la cuenta equivocada.
function matchBank(text: string, accounts: any[]): any | null {
  for (const a of accounts) {
    if (text.includes(a.bank.toLowerCase())) return a;
  }
  // Coincidencia por palabra clave del banco sin el prefijo "Banco" (ej: el
  // comprador escribe "bci" solo, y la cuenta está guardada como "BANCO BCI").
  for (const a of accounts) {
    const tokens = bankCoreTokens(a.bank);
    if (tokens.some(t => new RegExp(`\\b${t}\\b`, "i").test(text))) return a;
  }

  // "termina en 8502" / "últimos 8502" / "acaba en 02"
  const tailMatch = text.match(/(?:termina(?:n)?\s*(?:en)?|acaba(?:n)?\s*(?:en)?|[uú]ltimos?)\s*(\d{2,})/);
  if (tailMatch) {
    const digits = tailMatch[1];
    const matches = accounts.filter(a => String(a.accountNumber || "").endsWith(digits));
    if (matches.length === 1) return matches[0];
  }
  // Número suelto de 4+ dígitos sin la frase "termina en" (ej: "¿la 8502?")
  const looseDigits = text.match(/\b\d{4,}\b/g) || [];
  for (const digits of looseDigits) {
    const matches = accounts.filter(a => String(a.accountNumber || "").endsWith(digits));
    if (matches.length === 1) return matches[0];
  }

  // "la cuenta vista" / "la corriente" / "cuenta rut"
  for (const kw of ACCOUNT_TYPE_KEYWORDS) {
    if (text.includes(kw)) {
      const matches = accounts.filter(a => String(a.accountType || "").toLowerCase() === kw);
      if (matches.length === 1) return matches[0];
    }
  }

  return null;
}

function matchCompanyType(text: string): boolean | null {
  if (text.includes("empresa")) return true;
  if (text.includes("personal")) return false;
  return null;
}

function matchProblemType(text: string): string | null {
  if (text.includes("límite") || text.includes("limite") || text.includes("monto") || text.includes("mucho") || text.includes("pasa") || text.includes("permite") || text.includes("deja")) return "limit";
  if (text.includes("diario") || text.includes("dia")) return "limit_daily";
  if (text.includes("concreta") || text.includes("funciona") || text.includes("error") || text.includes("falla") || text.includes("rechaz") || text.includes("pudo") || text.includes("puedo") || text.includes("bloque") || text.includes("no me")) return "not_working";
  return null;
}

function matchThirdParty(text: string): boolean {
  return text.includes("tercer") || text.includes("espos") || text.includes("mamá") || text.includes("papá") || text.includes("herman") || text.includes("familiar") || text.includes("amigo") || text.includes("amiga");
}

function matchERUT(text: string): boolean {
  return text.includes("empresa") || text.includes("erut") || text.includes("factura") || text.includes("rut empresa");
}

function extractAmount(text: string): number {
  const nums = text.match(/\d[\d.]*/g);
  if (!nums) return 0;
  const clean = nums.map(n => Number(n.replace(/\./g, ""))).filter(n => n > 1000);
  return clean.length > 0 ? Math.min(...clean) : 0;
}

function findMatchingAd(activeAds: any[], order: any): any {
  if (!activeAds || activeAds.length === 0) return null;
  // Match real: cada orden trae el número del anuncio del que salió (advNo).
  // Antes esto "adivinaba" (el primer anuncio con métodos de pago), lo que
  // hacía que con 2+ anuncios gestionados se tomara el paymentPeriod y las
  // cuentas bancarias del anuncio equivocado.
  if (order?.advNo) {
    const exact = activeAds.find((a: any) => String(a.id) === String(order.advNo));
    if (exact) return exact;
  }
  return activeAds.find((a: any) => (a.paymentMethods || a.payments || []).length > 0) || activeAds[0] || null;
}

function isSingleBankAd(ad: any): boolean {
  const pms = ad.paymentMethods || ad.payments || [];
  return pms.length <= 1;
}

function normalizeBankName(name: string): string {
  return (name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const BANK_FILLER_WORDS = new Set(["banco", "de", "chile", "sa", "spa", "cl"]);

// Palabras "de verdad" de un nombre de banco, sin gen\u00e9ricos como "banco" o
// "chile" \u2014 permite reconocer que "BANCO BCI" (como lo guardaste) y "BCI
// Chile" (como lo llama Binance en el anuncio) son el mismo banco, aunque el
// orden de las palabras sea distinto y ninguno sea substring del otro.
function bankCoreTokens(name: string): string[] {
  return normalizeBankName(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2 && !BANK_FILLER_WORDS.has(w));
}

function bankNamesMatch(nameA: string, nameB: string): boolean {
  const a = normalizeBankName(nameA);
  const b = normalizeBankName(nameB);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = bankCoreTokens(nameA);
  const tokensB = bankCoreTokens(nameB);
  return tokensA.length > 0 && tokensB.length > 0 && tokensA.some(t => tokensB.includes(t));
}

// Cuando un banco tiene más de una cuenta guardada (ej: Banco Estado
// Corriente + Vista), solo UNA se ofrece por defecto (numerada, o enviada
// directo si es la única del banco) — se prefiere "corriente". Las demás
// (ej. la vista) quedan ocultas: solo se entregan si el comprador la pide
// explícitamente en texto libre (ver matchBank), nunca proactivamente.
// Regla confirmada por el usuario jul 2026: "la cuenta vista es para
// aquellas personas que preguntan si pueden transferir a esa cuenta".
function pickDefaultAccountsPerBank(accounts: any[]): any[] {
  const byBank = new Map<string, any[]>();
  for (const a of accounts) {
    const key = normalizeBankName(a.bank);
    if (!byBank.has(key)) byBank.set(key, []);
    byBank.get(key)!.push(a);
  }
  const result: any[] = [];
  for (const group of byBank.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }
    const corriente = group.find(a => String(a.accountType || "").toLowerCase() === "corriente");
    result.push(corriente || group[0]);
  }
  return result;
}

async function getAccountsForAd(tenantId: number, exchange: string, ad: any, label = "ONZE", opts: { includeHidden?: boolean } = {}): Promise<any[]> {
  const all = await prisma.p2PAccount.findMany({
    where: { tenantId, exchange, label, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  let result: any[];
  if (!ad) {
    result = all.map(parseAccountInfo);
  } else {
    const adBanks = (ad.paymentMethods || ad.payments || []).map((p: any) => {
      if (typeof p === "string") return p;
      return p.name || p.tradeMethodName || p.paymentMethodName || "";
    });

    if (adBanks.length === 0) {
      result = all.map(parseAccountInfo);
    } else {
      const filtered = all.filter(a => {
        const info = parseAccountInfo(a);
        return adBanks.some((ab: string) => bankNamesMatch(info.bank, ab));
      });
      result = (filtered.length > 0 ? filtered : all).map(parseAccountInfo);
    }
  }

  return opts.includeHidden ? result : pickDefaultAccountsPerBank(result);
}

// DESHABILITADO (jul 2026) — Binance enmascara el apodo del comprador a solo
// 3 caracteres + asteriscos (ej: "Use***", "And***"). Confirmado en vivo:
// revisando 10 órdenes reales, "Use***" y "And***" aparecían repetidos para
// compradores claramente distintos. Como "counterparty" es ese apodo
// enmascarado, usarlo para reconocer "es la misma persona de la vez pasada"
// producía falsos positivos reales (le ofreció a un comprador nuevo la
// cuenta de otro comprador anterior). Hasta que capturemos un identificador
// confiable (el evento de chat "seller_payed" trae el apodo REAL sin
// enmascarar y hasta el nombre legal — ver chat-agent.ts fetchMessages), esta
// función no debe volver a activarse solo cambiando este `return null`.
async function getBuyerHistory(tenantId: number, exchange: string, counterparty: string): Promise<{ bank: string; accountId: number } | null> {
  return null;
}

async function getAvailableAccounts(tenantId: number, exchange: string, label = "ONZE"): Promise<any[]> {
  const all = await prisma.p2PAccount.findMany({
    where: { tenantId, exchange, label, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  // Mismo criterio que getAccountsForAd: al repartir un pago entre varias
  // cuentas, las ocultas (vista) no se ofrecen proactivamente.
  return pickDefaultAccountsPerBank(all.map(parseAccountInfo));
}

async function buildBankChoices(tenantId: number, exchange: string, ad: any, label = "ONZE"): Promise<string> {
  const accounts = await getAccountsForAd(tenantId, exchange, ad, label);
  const lines = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`);
  return "Elige el banco para tu depósito:\n" + lines.join("\n");
}

function formatSingleAccount(a: any): string {
  let s = `Banco: ${a.bank}`;
  if (a.accountType) s += `\nTipo: ${capitalize(a.accountType)}`;
  s += `\nTitular: ${a.holder}`;
  if (a.rut) s += `\nRUT: ${a.rut}`;
  s += `\nCuenta: ${a.accountNumber}`;
  if (a.email) s += `\nCorreo: ${a.email}`;
  return s;
}

function parseAccountInfo(a: any): any {
  const info = typeof a.accountInfo === "string" ? JSON.parse(a.accountInfo) : (a.accountInfo || {});
  return { id: a.id, bank: info.bank || "", holder: info.holder || "", rut: info.rut || "", accountType: info.accountType || "", accountNumber: info.accountNumber || "", email: info.email || "" };
}

// Nuestras propias cuentas receptoras deberían ser todas del mismo titular
// hoy (ZINPLE SPA) — esto es solo una red de seguridad extra para que, si
// algún día se agrega una cuenta receptora de otro titular, nunca se mezcle
// con otra en un mismo split. La regla real del negocio (jul 2026) es otra:
// cuando el COMPRADOR divide su pago en 2+ transferencias, todas deben salir
// de cuentas a NOMBRE DEL COMPRADOR (misma persona en ambas) — no puede pagar
// una parte desde su cuenta y otra desde la de un tercero. Esa regla no se
// puede validar por código (no vemos las cuentas de origen del comprador),
// así que se le advierte explícitamente en el mensaje (ver offerSplitPayment).
function sameHolderAccounts(accounts: any[]): any[] {
  if (accounts.length === 0) return accounts;
  const primaryHolder = accounts[0].holder;
  return accounts.filter(a => a.holder === primaryHolder);
}

function distributeAmount(accounts: any[], perTransfer: number, total: number): any[] {
  if (perTransfer <= 0 || total <= 0) return [];
  const sameHolder = sameHolderAccounts(accounts);
  const result: any[] = [];
  let remaining = total;
  for (const acct of sameHolder) {
    if (remaining <= 0) break;
    const assign = Math.min(perTransfer, remaining);
    result.push({ ...acct, assignedAmount: assign });
    remaining -= assign;
  }
  if (remaining > 0) return [];
  return result;
}

// Mensaje + reparto de cuentas cuando el comprador dice que su banco tiene un
// límite por transferencia menor al monto total — usado tanto si lo pregunta
// de entrada (ej. "mi banco me deja 500mil, puedo hacer 2 pagos?") como si
// llega acá tras la pregunta de "¿cuánto te permite tu banco?".
async function offerSplitPayment(
  tenantId: number,
  exchange: string,
  client: any,
  order: any,
  cs: any,
  amount: number,
  label = "ONZE"
): Promise<void> {
  const total = Number(cs.totalAmount) || 0;
  const accounts = await getAvailableAccounts(tenantId, exchange, label);
  const chunks = distributeAmount(accounts, amount, total);
  if (chunks.length > 0) {
    const msg = ["Sin problema, vamos a dividir el pago. Aquí tienes las cuentas:\n"];
    chunks.forEach((c: any, i: number) => {
      msg.push(`--- Cuenta ${i + 1} ---\n${formatSingleAccount(c)}Monto: $${formatCLP(c.assignedAmount)}\n`);
    });
    msg.push("Importante: ambas transferencias deben salir de cuentas a tu nombre (el titular de la orden) — no aceptamos que una parte la pague otra persona.");
    msg.push("Ve realizando las transferencias y enviando los comprobantes de cada una. Quedo atento.");
    await sendAndTrack(client, exchange, order.orderNumber, cs, msg.join("\n"));
    await updateState(cs.id, "account_sent", { partialAmount: amount, chosenAccountIds: chunks.map((c: any) => c.id), retryCount: 0 });
  } else {
    await sendAndTrack(client, exchange, order.orderNumber, cs,
      "Entendido, con ese monto no podemos dividir el pago. ¿Puedes intentar con otra cuenta?"
    );
    await updateState(cs.id, "account_sent", { retryCount: 0 });
  }
}

function formatCLP(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 19 || h < 3) return "Buenas noches";
  return "Buen día";
}

// Nick de Binance usable como nombre en un saludo — descarta apodos que se
// vean claramente como usuario random (solo números, o muy largo/corto) para
// no sonar raro al "saludar por nombre".
function greetableName(nick?: string | null): string | null {
  const n = (nick || "").trim();
  if (!n || n.length < 2 || n.length > 24) return null;
  if (/^\d+$/.test(n)) return null;
  return n;
}

function buildInitialGreeting(isReturning: boolean, nick?: string | null): string {
  const ask = "¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.";
  const name = greetableName(nick);

  if (isReturning && name) {
    return pick([
      `¡Hola ${name}! Bienvenido/a de nuevo 👋 ${ask}`,
      `Hola ${name}, un gusto verte otra vez 🙌 ${ask}`,
      `${getTimeGreeting()}, ${name} 👋 ${ask}`,
    ]);
  }
  if (isReturning) {
    return pick([
      `¡Hola de nuevo! 👋 ${ask}`,
      `Hola, un gusto verte otra vez 🙌 ${ask}`,
    ]);
  }
  return pick([
    `${getTimeGreeting()} 👋 ${ask}`,
    `Hola, bienvenido/a 🙌 ${ask}`,
    `¡Hola! Antes de continuar, cuéntame: ${ask}`,
  ]);
}

function paymentAckMessage(): string {
  return pick([
    "Recibimos tu aviso de pago ✅ Vamos a verificar la información.",
    "Listo, vimos tu aviso de pago ✅ Ya estamos validando.",
    "Perfecto, aviso de pago recibido ✅ Un momento mientras confirmamos.",
  ]);
}

async function buildCompletionMessage(cs: any, tenantId: number, exchange: string): Promise<string> {
  const greeting = getTimeGreeting();
  const isNew = cs.counterparty ? !(cs.isReturning || await getBuyerHistory(tenantId, exchange, cs.counterparty)) : true;
  let msg = pick([
    "✨ Listo, tus USDT están disponibles. Gracias por tu preferencia, esperamos verte pronto.",
    "✨ Todo listo, tus USDT ya están en tu cuenta. Gracias por confiar en nosotros.",
    "✨ Confirmado, ya tienes tus USDT disponibles. ¡Gracias por la compra!",
  ]);
  if (isNew) msg += `\n\n⭐ Si todo estuvo bien, agradecemos una calificación positiva.`;
  msg += `\n\n🤗 ¡${greeting}!`;
  return msg;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function logMsg(tenantId: number, exchange: string, msg: string) {
  try {
    await prisma.p2PBotLog.create({
      data: { tenantId, level: "info", exchange, message: msg.slice(0, 500) },
    });
  } catch {}
}
