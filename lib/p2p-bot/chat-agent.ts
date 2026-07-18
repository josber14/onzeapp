import { prisma } from "@/lib/prisma";
import { acquireChatLock, releaseChatLock } from "./chat-lock";
import type { ChatState, ChatMessage } from "./types";

const MAX_RETRIES = 3;

// Confirmado en vivo (jul 2026): el listado de órdenes de Binance a veces
// reporta "CANCELLED_BY_SYSTEM" de forma transitoria por varios minutos y
// después vuelve a "TRADING" solo, sin que nada real haya cambiado (mismo
// tipo de inconsistencia eventual entre endpoints ya documentada en
// AGENTS.md). Si cerráramos la conversación en la primera lectura de
// "cancelada", un comprador con una orden REAL y activa se quedaría sin
// respuesta del bot para siempre (el estado "closed" excluye procesar sus
// mensajes). Por eso exigimos ver "cancelada" de forma sostenida antes de
// cerrar — ver isCancelled más abajo.
const cancelledSeenAt = new Map<string, number>();
const CANCEL_CONFIRM_MS = 60_000;

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

  // Cada orden se procesa en paralelo (no una por una) — cada una tiene su
  // propio candado (ver processOrder), así que atender varias conversaciones
  // a la vez es seguro y evita que todo el mundo espere en fila detrás de
  // quien se esté atendiendo en ese momento (confirmado en vivo jul 2026: con
  // el procesamiento secuencial + el delay humano de cada respuesta, un
  // comprador esperó ~2 min con solo 5 conversaciones activas).
  await Promise.all(liveOrders.map(async (rawOrder: any) => {
    const orderNo = rawOrder.orderNumber ?? rawOrder.orderNo ?? rawOrder.id ?? "";
    if (!orderNo) return;
    if (seenOrders.has(orderNo)) return;
    seenOrders.add(orderNo);

    const order = normalizeOrder(rawOrder, exchange);
    await logMsg(tenantId, exchange, `[Chat] raw ${orderNo} status=${order.status} group=${order.group} rawStatus=${(rawOrder.orderStatus ?? rawOrder.status ?? '?')} tradeType=${rawOrder.tradeType || '?'} verified=${order.verified} rawVerify=${rawOrder.additionalKycVerify}`);
    // Antes esto saltaba órdenes canceladas ANTES de llegar a processOrder —
    // pero el cierre real (cs.state -> "closed") vive DENTRO de
    // processOrderLocked, así que nunca se ejecutaba: una orden cancelada
    // por Binance (vencimiento) se quedaba congelada para siempre en el
    // último estado que tenía (ej. "account_sent"). Confirmado en vivo (jul
    // 2026): una orden llevaba 6+ horas así. processOrderLocked ya maneja
    // bien tanto "sin chat state" (no hace nada) como "con chat state"
    // (la cierra, barato, antes de tocar la API de mensajes de Binance) —
    // así que no hace falta filtrar acá.

    try {
      await processOrder(tenantId, exchange, client, order, activeAds, label);
    } catch (e: any) {
      await logMsg(tenantId, exchange, `Chat error ${orderNo}: ${e.message}`);
    }
  }));

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

// Candado por ORDEN (no por cuenta completa) — dos instancias del servidor
// (o dos ciclos superpuestos) nunca procesan la MISMA orden a la vez, pero
// distintas órdenes sí se pueden atender en paralelo sin esperar en fila.
async function processOrder(
  tenantId: number,
  exchange: "binance" | "bybit",
  client: any,
  order: any,
  activeAds: any[],
  label = "ONZE"
) {
  const lockKey = `${tenantId}:${exchange}:${order.orderNumber}`;
  let gotLock: boolean;
  try {
    // Mismo salvavidas que abajo, pero para el propio intento de adquirir
    // el lock (una llamada a la base de datos que en teoría también podría
    // colgarse, ej. si el pool de conexiones está agotado).
    gotLock = await Promise.race([
      acquireChatLock(lockKey),
      new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT: acquireChatLock no terminó en 10s")), 10000)),
    ]);
  } catch (e: any) {
    await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: error/timeout adquiriendo el lock: ${e.message}`);
    return;
  }
  if (!gotLock) {
    await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: otra instancia ya la está procesando, se salta este tick`);
    return;
  }
  // Checkpoint de diagnóstico: si esto no aparece en los logs pero tampoco
  // hay ningún error después, el problema está ANTES de acá (adquirir el
  // lock). Si aparece pero nunca se ve "processOrder {orden}" (el próximo
  // checkpoint dentro de processOrderLocked), el problema está adentro.
  await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: lock adquirido, empezando a procesar`);
  try {
    // Salvavidas: si processOrderLocked se cuelga (nunca resuelve ni
    // rechaza — confirmado en vivo jul 2026, una orden real se quedó sin
    // ningún mensaje del bot por 5+ minutos sin ningún error en los logs),
    // esto evita que el lock quede atascado para siempre y deja un rastro
    // claro en vez de silencio total.
    await Promise.race([
      processOrderLocked(tenantId, exchange, client, order, activeAds, label),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT: processOrderLocked no terminó en 20s")), 20000)),
    ]);
  } finally {
    await releaseChatLock(lockKey);
  }
}

async function processOrderLocked(
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

  // If order is cancelled while in mid-conversation, close it — pero solo
  // tras verla cancelada de forma sostenida (CANCEL_CONFIRM_MS), no en la
  // primera lectura, por la inconsistencia eventual de Binance descrita arriba.
  const debounceKey = `${tenantId}:${exchange}:${orderNo}`;
  if (isCancelled && cs.state !== "completed" && cs.state !== "closed" && cs.state !== "awaiting_verification") {
    const firstSeen = cancelledSeenAt.get(debounceKey);
    if (!firstSeen) {
      cancelledSeenAt.set(debounceKey, Date.now());
    } else if (Date.now() - firstSeen >= CANCEL_CONFIRM_MS) {
      await updateState(cs.id, "closed");
      cancelledSeenAt.delete(debounceKey);
      return;
    }
  } else if (cancelledSeenAt.has(debounceKey)) {
    // Se vio activa de nuevo — era el glitch, no una cancelación real.
    cancelledSeenAt.delete(debounceKey);
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

  // Binance revela el nombre real (sin enmascarar) recién cuando el comprador
  // marca "Pagado" — llega en un mensaje de sistema "seller_payed", nunca
  // antes. Se captura acá (una sola vez por orden) y se guarda también en
  // P2PBuyerIdentity para poder reconocer a este comprador en un pedido
  // FUTURO (el apodo que se ve ANTES del pago viene enmascarado a 3 letras y
  // colisiona entre personas distintas — no sirve para esto).
  if (!cs.realName) {
    const payed = extractSellerPayed(msgs);
    if (payed?.realName) {
      await prisma.p2PChatState.update({ where: { id: cs.id }, data: { realName: payed.realName } });
      cs.realName = payed.realName;
      if (payed.nickName) {
        await prisma.p2PBuyerIdentity.upsert({
          where: { tenantId_exchange_label_nickName: { tenantId, exchange, label, nickName: payed.nickName } },
          update: { realName: payed.realName },
          create: { tenantId, exchange, label, nickName: payed.nickName, realName: payed.realName },
        }).catch(() => {});
      }
    }
  }

  await logMsg(tenantId, exchange, `[Chat] processOrder ${orderNo} state=${cs.state} pending=${isPending} paid=${isPaid} msgs=${msgs.length} lastClientMsg=${lastClientMsg?.content?.slice(0, 30)?.replace(/\n/g,'|') || 'null'}`);

  if (cs.state === "awaiting_verification") {
    // El comprador puede escribir algo (ej. "Atento") ANTES de que Binance
    // confirme la verificación KYC. Ese mensaje no es respuesta a ninguna
    // pregunta nuestra todavía — avanzar el cursor igual, si no se "reproduce"
    // como respuesta a la primera pregunta real (personal/empresa) apenas se
    // verifica la orden. Bug real confirmado en vivo (jul 2026): un comprador
    // respondió "1" y el bot contestó "No entendí" — en realidad estaba
    // respondiendo tarde a este "Atento" viejo, no al "1".
    if (lastClientMsg) {
      const msgTime = lastClientMsg.createTime > 0 ? new Date(lastClientMsg.createTime) : new Date();
      const extra: Record<string, any> = { lastClientMsgAt: msgTime };
      // Guardamos el PRIMER mensaje que escribe antes de verificar (ej. "hola
      // la cuenta porfa", "tendrás 3 cuentas?") para que handleVerified pueda
      // ir directo al grano en el saludo en vez de ignorarlo con la pregunta
      // genérica de personal/empresa — ver matchWantsAccount más abajo.
      if (!cs.pendingFirstMsg && lastClientMsg.content) {
        extra.pendingFirstMsg = lastClientMsg.content;
        cs.pendingFirstMsg = lastClientMsg.content;
      }
      await prisma.p2PChatState.update({ where: { id: cs.id }, data: extra });
      cs.lastClientMsgAt = msgTime;
    }
    if (order.verified) {
      await handleVerified(tenantId, exchange, client, cs, order, activeAds, label);
    }
    return;
  }

  // Handle paid status BEFORE processing client messages
  if (isPaid) {
    if (cs.state === "account_sent") {
      await sendAndTrack(client, exchange, orderNo, cs, paymentAckMessage(firstNameFrom(cs.realName)));
      await updateState(cs.id, "payment_made", { paidAt: new Date() });
      return;
    }
    if (!["account_sent", "payment_made", "awaiting_comprobant", "completed", "closed", "awaiting_verification"].includes(cs.state)) {
      await sendAndTrack(client, exchange, orderNo, cs, paymentAckMessage(firstNameFrom(cs.realName)));
      await updateState(cs.id, "payment_made", { paidAt: new Date() });
      return;
    }
  }

  // Handle client response for any active conversation state
  if (lastClientMsg && cs.state !== "completed" && cs.state !== "closed" && cs.state !== "payment_made") {
    const textContent = lastClientMsg.content?.trim() || "";
    if (!textContent && lastClientMsg.imageUrl) {
      // Avanzar el cursor SIEMPRE, aunque no actuemos sobre esta imagen todavía.
      // Bug real confirmado en vivo (jul 2026): si no se avanza acá, el cursor
      // queda pegado para siempre en esta misma imagen (comprobante enviado
      // antes de que Binance marque la orden como pagada) — findLastClientMsg
      // sigue devolviendo esta misma imagen en cada ciclo, y CUALQUIER mensaje
      // de texto que el comprador mande después (ej. "le hago 2 depósitos?")
      // queda invisible para el bot indefinidamente.
      const msgTime = lastClientMsg.createTime > 0 ? new Date(lastClientMsg.createTime) : new Date();
      await prisma.p2PChatState.update({ where: { id: cs.id }, data: { lastClientMsgAt: msgTime } });
      cs.lastClientMsgAt = msgTime;
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
      const name = firstNameFrom(cs.realName);
      await sendAndTrack(client, exchange, orderNo, cs,
        (name ? `Hola ${name}, ¿nos puedes` : "Hola, ¿nos puedes") + " enviar el comprobante del pago para agilizar la validación?" + extra
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

  const knownRealName = order.counterparty ? await findKnownRealName(tenantId, exchange, label, order.counterparty) : null;
  const isReturning = !!knownRealName;

  // Camino rápido: si lo primero que escribió (antes de verificar) ya pedía
  // la cuenta directamente, reconocemos el pedido en el mismo saludo — pero
  // seguimos preguntando personal/empresa (regla del negocio: siempre hay
  // que saberlo, nunca se salta). pendingFirstMsg queda guardado a propósito
  // (no se limpia acá) para que awaiting_account_type lo lea de nuevo y
  // mande la(s) cuenta(s) apenas responda, sin un paso extra de "¿qué
  // banco?" si ya se puede resolver.
  const firstMsg = (cs.pendingFirstMsg || "").toLowerCase();
  const name = firstNameFrom(knownRealName);
  const hello = isReturning && name ? `¡Hola ${name}!` : "¡Hola!";
  let greeting: string;
  if (firstMsg && matchWantsAccount(firstMsg)) {
    const wantsMultiple = matchWantsMultipleAccounts(firstMsg);
    greeting = `${hello} Ya te paso ${wantsMultiple ? "las cuentas que necesites" : "la cuenta"} — antes dime: ¿transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.`;
  } else {
    greeting = buildInitialGreeting(isReturning, name);
  }

  const sent = await sendAndTrack(client, exchange, order.orderNumber, cs,
    greeting,
    createdAtTs
  );
  if (sent) {
    await updateState(cs.id, "awaiting_account_type", {
      isCompany: false,
      isReturning,
      ...(knownRealName ? { realName: knownRealName } : {}),
    });
  }
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
          const pending = (cs.pendingFirstMsg || "").toLowerCase();
          const named = pending ? matchBank(pending, allAccounts) : null;
          if (pending && matchWantsMultipleAccounts(pending)) {
            const msg = erutNote + "\n\nEstas son nuestras cuentas disponibles:\n\n" +
              accounts.map((a: any, i: number) => `--- Cuenta ${i + 1} ---\n${formatSingleAccount(a)}`).join("\n\n") +
              "\n\nCuando realices cada pago:\n- Marca \"Pagado\" en la orden\n- Envía los comprobantes aquí en el chat";
            await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
            await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, chosenBank: accounts.map((a: any) => a.bank).join(", "), chosenAccountIds: accounts.map((a: any) => a.id), retryCount: 0, pendingFirstMsg: null });
          } else if (named) {
            await sendAccountWithErutNote(tenantId, exchange, client, order, { ...cs, isCompany: true }, named);
            await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, chosenBank: named.bank, chosenAccountIds: [named.id], retryCount: 0, pendingFirstMsg: null });
          } else {
            const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
            const msg = erutNote + "\n\n¿A qué cuenta deseas transferir?\n" + choices;
            await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
            await updateState(cs.id, "awaiting_bank_choice", { isCompany: true, erutRequested: true, retryCount: 0 });
          }
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
          // Camino rápido: si en el primer mensaje ya pidió varias cuentas o
          // nombró un banco puntual, resolvemos directo en vez de preguntar
          // de nuevo — pero la pregunta personal/empresa de arriba nunca se
          // saltó, solo se evita un paso extra AHORA que ya la respondió.
          const pending = (cs.pendingFirstMsg || "").toLowerCase();
          const named = pending ? matchBank(pending, allAccounts) : null;
          if (pending && matchWantsMultipleAccounts(pending)) {
            const msg = "Estas son nuestras cuentas disponibles:\n\n" +
              accounts.map((a: any, i: number) => `--- Cuenta ${i + 1} ---\n${formatSingleAccount(a)}`).join("\n\n") +
              "\n\nCuando realices cada pago:\n- Marca \"Pagado\" en la orden\n- Envía los comprobantes aquí en el chat";
            await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
            await updateState(cs.id, "account_sent", { chosenBank: accounts.map((a: any) => a.bank).join(", "), chosenAccountIds: accounts.map((a: any) => a.id), retryCount: 0, pendingFirstMsg: null });
          } else if (named) {
            await sendAccountWithErutNote(tenantId, exchange, client, order, { ...cs, isCompany: false }, named);
            await updateState(cs.id, "account_sent", { chosenBank: named.bank, chosenAccountIds: [named.id], retryCount: 0, pendingFirstMsg: null });
          } else {
            // New customer, multiple accounts: ask
            const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
            await sendAndTrack(client, exchange, order.orderNumber, cs,
              `¿A qué cuenta deseas transferir?\n${choices}\n\nTambién puedes escribir el nombre del banco.`
            );
            await updateState(cs.id, "awaiting_bank_choice", { isCompany: false, retryCount: 0 });
          }
        }
      } else if (matchProblemType(textLower) === "not_working") {
        // Reclamo genérico ("no me deja", "no funciona", "no puedo") antes
        // de responder personal/empresa. Bug real confirmado en vivo (jul
        // 2026): "No me deja la cuenta" se leía como si hubiera elegido la
        // opción 2 (Empresa) — el comprador terminó con un pedido de ERUT
        // que nunca hizo. Ahora, en vez de asumir nada, se pregunta qué pasó
        // para entender la causa real y poder ayudar.
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          pick([
            "Cuéntame, ¿qué problema tuviste? Así te ayudo a resolverlo.",
            "¿Qué pasó exactamente? Cuéntame para ver cómo lo solucionamos.",
          ])
        );
        await updateState(cs.id, "awaiting_account_type", { retryCount: 0 });
      } else if (matchWantsAccount(textLower)) {
        // Pidió la cuenta pero no dijo personal/empresa — esa pregunta NUNCA
        // se salta. Se reconoce el pedido en el mismo mensaje y se guarda
        // (pendingFirstMsg) para resolver directo apenas responda 1 o 2,
        // sin otro paso intermedio de "¿qué banco?".
        const wantsMultiple = matchWantsMultipleAccounts(textLower);
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          `Claro, ya te paso ${wantsMultiple ? "las cuentas que necesites" : "la cuenta"} — antes dime: ¿transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.`
        );
        await updateState(cs.id, "awaiting_account_type", { pendingFirstMsg: textLower, retryCount: 0 });
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
        await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
        await sendThenClose(client, exchange, order.orderNumber, cs,
          "Lamentamos el problema con tu banco. Cuando soluciones y estés listo, vuelve a tomar la orden. ¡Te esperamos! 👍🏻"
        );
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
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
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor.", { retryCount });
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
    await sendThenClose(client, exchange, order.orderNumber, cs,
      "Puede ser un problema con tu banco. Lamentablemente no podemos extender más el tiempo. Intenta más tarde cuando se resuelva.\n\nQuedamos atentos para la próxima.",
      { transferFailCount: 0 }
    );
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
    await sendThenClose(client, exchange, order.orderNumber, cs,
      "Puede ser un problema con tu banco. Lamentablemente no podemos extender más el tiempo. Intenta más tarde cuando se resuelva.\n\nQuedamos atentos para la próxima.",
      { transferFailCount: 0 }
    );
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

// Busca el mensaje de sistema "seller_payed" (se dispara cuando el comprador
// marca "Pagado") — es el único punto donde Binance manda el apodo SIN
// enmascarar junto con el nombre legal completo, ej:
// {"nickName":"MarcoMoye","realName":"MOYE ORELLANA MARCO ANTONIO","type":"seller_payed"}
function extractSellerPayed(msgs: ChatMessage[]): { nickName: string | null; realName: string | null } | null {
  for (const m of msgs) {
    if (m.type !== "system") continue;
    try {
      const parsed = JSON.parse(m.content);
      if (parsed?.type === "seller_payed" && parsed?.realName) {
        return { nickName: parsed.nickName ?? null, realName: parsed.realName };
      }
    } catch {
      // no era JSON, ignorar
    }
  }
  return null;
}

// El nombre legal viene "APELLIDO1 APELLIDO2 NOMBRE1 [NOMBRE2]" (formato de
// cédula latinoamericano — confirmado con varios ejemplos reales en jul
// 2026). Heurística: con 3+ palabras, el primer nombre de pila es la 3ra;
// con 2 palabras, es la 1ra. Si falla, mejor no usar nombre que usar uno mal.
function firstNameFrom(realName?: string | null): string | null {
  if (!realName) return null;
  const parts = realName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const raw = parts.length >= 3 ? parts[2] : parts[0];
  if (!raw || raw.length < 2) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
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
          await logMsg(cs.tenantId, exchange, `WS chat falló ${orderNo}: ${wsRes.error}`);
        }
      } catch (wsErr: any) {
        await logMsg(cs.tenantId, exchange, `WS chat err ${orderNo}: ${wsErr.message}`);
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

// Cierra la conversación SOLO si el mensaje de despedida realmente se envió.
// Bug real confirmado en vivo (jul 2026): el envío por WS falló con
// "ILLEGAL_PARAM" (falla de Binance, no del contenido del mensaje — ya se
// había mandado ese mismo texto con éxito en otras órdenes) justo en el
// mensaje de cierre, pero el código cerraba igual — el comprador se quedó
// con 4 preguntas reales sin ninguna respuesta, viendo silencio total. Si el
// envío falla, NO cerramos — se reintenta en el próximo ciclo.
async function sendThenClose(client: any, exchange: string, orderNo: string, cs: any, msg: string, extra: Record<string, any> = {}): Promise<boolean> {
  const sent = await sendAndTrack(client, exchange, orderNo, cs, msg);
  if (sent) {
    await updateState(cs.id, "closed", extra);
  }
  return sent;
}

function matchOption(text: string, max: number): number | null {
  const num = parseInt(text);
  if (!isNaN(num) && num >= 1 && num <= max) return num;
  if (/^\d+$/.test(text)) return null;
  // Bug real confirmado en vivo (jul 2026): con "text.startsWith" cualquier
  // reclamo que empezara con "no" (ej. "No me deja la cuenta") se
  // interpretaba como si hubiera elegido la opción 2 — en un menú
  // "1) Personal 2) Empresa" eso mandaba al comprador directo al flujo de
  // factura/ERUT sin que lo hubiera pedido. Ahora sí/no solo cuenta cuando
  // es TODA la respuesta (nada más, sin texto adicional) — un reclamo largo
  // nunca debe leerse como un simple "no".
  const trimmed = text.trim().replace(/[.,!?¡¿]+$/, "");
  if (trimmed === "sí" || trimmed === "si" || trimmed === "yes") return 1;
  if (trimmed === "no") return 2;
  if (max >= 3 && text.includes("tercer")) return 3;
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

// Compradores que van directo al grano: "hola la cuenta porfa", "cuenta banco
// estado", "tendrás 3 cuentas?", "los datos porfa". Confirmado en vivo (jul
// 2026): forzarlos a pasar por el saludo genérico y DESPUÉS por un menú de
// banco por número (dos pasos separados) hizo que un comprador cancelara la
// orden ("Chao mucha vuelta"). La pregunta personal/empresa NUNCA se salta
// (regla del negocio) — lo que se evita es el paso EXTRA de "¿qué banco?"
// cuando ya se puede resolver sin ambigüedad a partir de lo que escribió.
function matchWantsAccount(text: string): boolean {
  return /\bcuentas?\b/.test(text) || text.includes("los datos") || text.includes("donde deposito") || text.includes("donde transfiero") || text.includes("dónde deposito") || text.includes("dónde transfiero");
}

// "tendrás 3 cuentas?", "varias cuentas", "más de una cuenta" — quiere la
// LISTA completa para repartir el pago él mismo, no una cuenta puntual.
function matchWantsMultipleAccounts(text: string): boolean {
  return /\b[2-9]\s*cuentas\b/.test(text) || text.includes("varias cuentas") || text.includes("distintas cuentas") || text.includes("otras cuentas") || text.includes("más de una cuenta") || text.includes("mas de una cuenta");
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
// cuenta de otro comprador anterior). Ahora capturamos un identificador
// confiable (P2PBuyerIdentity, ver extractSellerPayed/findKnownRealName más
// abajo) pero solo para el SALUDO por nombre, que es de bajo riesgo si falla
// (en el peor caso, no saluda por nombre a alguien que sí es recurrente).
// Ofrecer la CUENTA de la vez pasada es más delicado (dinero real yendo a la
// cuenta equivocada si el match es ambiguo) — sigue desactivado hasta migrar
// esta función al mismo identificador confiable con la misma guarda de
// ambigüedad que ya usa findKnownRealName.
async function getBuyerHistory(tenantId: number, exchange: string, counterparty: string): Promise<{ bank: string; accountId: number } | null> {
  return null;
}

// El apodo enmascarado que se ve ANTES del pago (order.counterPartNickName,
// ej. "Use***") es siempre los primeros 3 caracteres del apodo real +
// "***" (confirmado con varios ejemplos reales). Buscamos en
// P2PBuyerIdentity todos los apodos reales que empiecen igual — pero SOLO
// devolvemos un nombre si hay exactamente UNA coincidencia. Con prefijos muy
// comunes (ej. "Use" de los apodos autogenerados "User-xxxxx" de Binance)
// puede haber varias personas distintas con el mismo prefijo — en ese caso,
// mejor no saludar por nombre que arriesgarse a llamar a alguien nuevo por
// el nombre de otro comprador (el mismo error que ya rompió este feature
// una vez con el apodo enmascarado completo).
// "User-6d6f1", "P2P-803c36nx" — apodos por DEFECTO que Binance asigna solo
// cuando la persona nunca puso uno propio. Los comparten masivamente
// compradores sin ninguna relación entre sí (confirmado en vivo jul 2026: el
// bot terminó llamando "Diego" a varios compradores distintos, porque el
// primer "User-xxxxx" que capturamos fue justo el de Diego, y al ser el
// único visto hasta ahora con prefijo "Use" pasaba la prueba de "sin
// ambigüedad" — pero "Use***"/"P2P***" NUNCA son un identificador único, sin
// importar cuántos ejemplos hayamos guardado todavía). Se excluyen SIEMPRE
// de esta búsqueda, no solo cuando hay colisión visible en nuestra tabla.
const GENERIC_NICK_PATTERNS = [/^user-/i, /^p2p-/i];

async function findKnownRealName(tenantId: number, exchange: string, label: string, maskedNick?: string | null): Promise<string | null> {
  const m = /^(.{1,3})\*+$/.exec((maskedNick || "").trim());
  if (!m) return null;
  const prefix = m[1];
  const candidates = await prisma.p2PBuyerIdentity.findMany({
    where: { tenantId, exchange, label, nickName: { startsWith: prefix } },
    select: { nickName: true, realName: true },
  });
  const trustworthy = candidates.filter(c => !GENERIC_NICK_PATTERNS.some(re => re.test(c.nickName)));
  const uniqueNames = new Set(trustworthy.map(c => c.realName));
  if (uniqueNames.size !== 1) return null;
  return trustworthy[0].realName;
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
  // cs.totalAmount está en USDT (ver create de P2PChatState, viene de
  // order.amount) — usar ese número acá era el bug real confirmado en vivo
  // (jul 2026): una compra de $225.000 CLP terminó mostrando "Monto: $238"
  // (el equivalente en USDT, no en CLP) porque se usaba como si fuera CLP.
  // order.totalPrice es el monto real en CLP, que es lo que hay que repartir.
  const total = Number(order.totalPrice) || 0;
  let accounts = await getAvailableAccounts(tenantId, exchange, label);
  // La primera cuota va al banco que YA se le había mandado antes (lo más
  // probable es que ya haya empezado a transferir ahí) — el resto de las
  // cuotas usa bancos DISTINTOS, nunca repite uno ya ofrecido. Antes de este
  // fix, el reparto ignoraba esto y podía mandar el mismo banco (ej. Banco
  // Estado) para las dos cuotas, algo que el comprador ya había dicho que no
  // le funcionaba para el monto completo.
  if (cs.chosenBank) {
    accounts = [...accounts.filter((a: any) => a.bank === cs.chosenBank), ...accounts.filter((a: any) => a.bank !== cs.chosenBank)];
  }
  const chunks = distributeAmount(accounts, amount, total);
  if (chunks.length > 0) {
    const msg = ["Sin problema, vamos a dividir el pago. Aquí tienes las cuentas:\n"];
    chunks.forEach((c: any, i: number) => {
      msg.push(`--- Cuenta ${i + 1} ---\n${formatSingleAccount(c)}\nMonto: $${formatCLP(c.assignedAmount)}\n`);
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

function buildInitialGreeting(isReturning: boolean, name?: string | null): string {
  const ask = "¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.";

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

function paymentAckMessage(name?: string | null): string {
  const msg = pick([
    "Recibimos tu aviso de pago ✅ Vamos a verificar la información.",
    "Listo, vimos tu aviso de pago ✅ Ya estamos validando.",
    "Perfecto, aviso de pago recibido ✅ Un momento mientras confirmamos.",
  ]);
  return name ? `${name}, ${msg}` : msg;
}

async function buildCompletionMessage(cs: any, tenantId: number, exchange: string): Promise<string> {
  const greeting = getTimeGreeting();
  const isNew = cs.counterparty ? !(cs.isReturning || await getBuyerHistory(tenantId, exchange, cs.counterparty)) : true;
  const name = firstNameFrom(cs.realName);
  let msg = pick([
    "✨ Listo, tus USDT están disponibles. Gracias por tu preferencia, esperamos verte pronto.",
    "✨ Todo listo, tus USDT ya están en tu cuenta. Gracias por confiar en nosotros.",
    "✨ Confirmado, ya tienes tus USDT disponibles. ¡Gracias por la compra!",
  ]);
  if (name) msg = `${name}, ` + msg;
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
