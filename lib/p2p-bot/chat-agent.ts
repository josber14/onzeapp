import { prisma } from "@/lib/prisma";
import { acquireChatLock, releaseChatLock } from "./chat-lock";
import { classifyIntent } from "./chat-brain";
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

    // Pedido explícito del usuario (jul 2026): el bot solo debe hablar de
    // operaciones en CLP. Confirmado en vivo: una venta P2P directa hecha
    // por fuera de los anuncios gestionados (para comprar bs/VES) hizo que
    // el bot le empezara a chatear con datos bancarios en CLP a alguien que
    // ni siquiera está en esa moneda. Se ignora por completo cualquier
    // orden que no sea CLP — nunca se crea ni se toca su P2PChatState.
    if (order.fiat && order.fiat !== "CLP") return;

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
    //
    // OJO con bajar este número: Promise.race NO cancela la promesa
    // perdedora — si el timeout gana la carrera, processOrderLocked sigue
    // corriendo en segundo plano, pero el `finally` de abajo YA liberó el
    // lock. El siguiente ciclo (~15-18s después) entra a procesar la MISMA
    // orden en paralelo con la instancia "vieja" que sigue viva, causando
    // mensajes duplicados y respuestas cruzadas — confirmado en vivo en 2
    // órdenes reales el mismo día, justo cuando se mandaban los 3 mensajes
    // de la cuenta (3 envíos reales, cada uno con su propio delay, suman
    // varios segundos). 35s da margen real para un ciclo legítimo con IA +
    // 3 envíos, sin dejar de detectar un cuelgue real (que tardó 5+ minutos).
    await Promise.race([
      processOrderLocked(tenantId, exchange, client, order, activeAds, label),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT: processOrderLocked no terminó en 35s")), 35000)),
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
    await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "completed", { completedAt: new Date() }, order.createdAt ? new Date(order.createdAt).getTime() : undefined);
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
        // orderCount incrementa acá porque este bloque (if !cs.realName) solo
        // corre UNA vez por orden — cuenta compras reales, no cada vez que se
        // relee el chat. Se guarda también qué cuenta/tipo usó esta vez, para
        // poder ofrecérsela directo la próxima ("¿misma cuenta de la vez
        // pasada?") en vez de repetirle las mismas preguntas.
        const lastAccountId = Array.isArray(cs.chosenAccountIds) && cs.chosenAccountIds.length === 1 ? Number(cs.chosenAccountIds[0]) : null;
        await prisma.p2PBuyerIdentity.upsert({
          where: { tenantId_exchange_label_nickName: { tenantId, exchange, label, nickName: payed.nickName } },
          update: {
            realName: payed.realName,
            orderCount: { increment: 1 },
            ...(lastAccountId ? { lastBank: cs.chosenBank || null, lastAccountId, lastIsCompany: !!cs.isCompany } : {}),
          },
          create: {
            tenantId, exchange, label, nickName: payed.nickName, realName: payed.realName,
            lastBank: lastAccountId ? (cs.chosenBank || null) : null,
            lastAccountId,
            lastIsCompany: !!cs.isCompany,
          },
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
      await sendThenTransition(client, exchange, orderNo, cs, paymentAckMessage(firstNameFrom(cs.realName)), "payment_made", { paidAt: new Date() });
      return;
    }
    if (!["account_sent", "payment_made", "awaiting_comprobant", "completed", "closed", "awaiting_verification"].includes(cs.state)) {
      await sendThenTransition(client, exchange, orderNo, cs, paymentAckMessage(firstNameFrom(cs.realName)), "payment_made", { paidAt: new Date() });
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

  // Aviso de "orden por vencer" — pedido explícito del usuario (jul 2026):
  // debe dispararse en CUALQUIER etapa de la conversación mientras la orden
  // siga pendiente de pago (antes solo aplicaba ANTES de la verificación
  // KYC, así que casi nunca se disparaba en la práctica). Se usa nuestro
  // propio cálculo de tiempo (createdAt + payTime del anuncio) en vez de
  // depender de detectar el mensaje de sistema exacto que manda Binance —
  // más confiable. 4:30 restantes, confirmado por el usuario.
  //
  // Bug real confirmado en vivo (jul 2026, causó una orden cancelada):
  // excluir "awaiting_problem" del estado actual NO alcanza para mandar el
  // aviso una sola vez, porque la ventana de 4.5 min sigue activa después de
  // resolver el aviso y volver al estado original (resumeState) — en el
  // siguiente ciclo (~15s después) la condición se vuelve a cumplir y el
  // aviso interrumpe DE NUEVO, justo antes de que el comprador alcance a
  // responder la pregunta original que quedó pendiente. `expiryWarnedAt` se
  // fija la primera vez y nunca se vuelve a null — así el aviso manda una
  // única vez de verdad por orden, sin importar cuántas veces la
  // conversación entre y salga de "awaiting_problem" dentro de la ventana.
  if (
    isPending &&
    !cs.expiryWarnedAt &&
    cs.state !== "awaiting_verification" &&
    cs.state !== "awaiting_problem" &&
    cs.state !== "payment_made" &&
    cs.state !== "completed" &&
    cs.state !== "closed"
  ) {
    const payWindow = Number(order.payTime ?? 15) * 60 * 1000;
    const createdAt = new Date(order.createdAt || order.executedAt || Date.now()).getTime();
    const expiresAt = createdAt + payWindow;
    const warnAt = expiresAt - 4.5 * 60 * 1000;

    if (Date.now() >= warnAt && Date.now() < expiresAt) {
      // Pedido explícito del usuario (jul 2026): pregunta natural de sí/no,
      // sin menú numerado — "Hola" solo va en el PRIMER mensaje de la
      // conversación, este aviso llega a mitad de conversación. Se guarda
      // el estado actual (preInterruptState) para poder volver ahí una vez
      // resuelto este aviso puntual, sin importar en qué parte de la
      // conversación se haya interrumpido.
      await sendThenTransition(client, exchange, orderNo, cs,
        "Tu orden está por vencer. ¿Necesitas más tiempo para completar el pago?",
        "awaiting_problem", { preInterruptState: cs.state, expiryWarnedAt: new Date() }
      );
      return;
    }
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
      // "Hola" solo va en el primer mensaje de la conversación — este aviso
      // llega minutos después del saludo inicial, nunca debe repetirlo.
      const name = firstNameFrom(cs.realName);
      await sendThenTransition(client, exchange, orderNo, cs,
        (name ? `${name}, ¿nos puedes` : "¿Nos puedes") + " enviar el comprobante del pago para agilizar la validación?" + extra,
        "awaiting_comprobant"
      );
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

  // "known" solo existe si ya vimos a esta persona completar una compra
  // ANTES (el nombre real se captura recién al completar una orden) — o sea,
  // si existe, esta orden ya es su 2da compra o más. Coincide exactamente
  // con la regla confirmada por el usuario: trato de cliente conocido desde
  // la 2da compra en adelante.
  const known = order.counterparty ? await findKnownRealName(tenantId, exchange, label, order.counterparty) : null;
  const isReturning = !!known;

  // Camino rápido: si lo primero que escribió (antes de verificar) ya pedía
  // la cuenta directamente, reconocemos el pedido en el mismo saludo — pero
  // seguimos preguntando personal/empresa (regla del negocio: siempre hay
  // que saberlo, nunca se salta). pendingFirstMsg queda guardado a propósito
  // (no se limpia acá) para que awaiting_account_type lo lea de nuevo y
  // mande la(s) cuenta(s) apenas responda, sin un paso extra de "¿qué
  // banco?" si ya se puede resolver.
  const firstMsg = (cs.pendingFirstMsg || "").toLowerCase();
  const name = firstNameFrom(known?.realName);
  const hello = isReturning && name ? `¡Hola ${name}!` : "¡Hola!";

  // A propósito NO se guarda `realName: known.realName` en cs acá (bug real
  // confirmado en vivo, jul 2026): eso hacía que `!cs.realName` en
  // processOrderLocked (el guardia que captura seller_payed UNA vez por
  // orden) quedara siempre en false para cualquier cliente ya reconocido —
  // es decir, para un cliente frecuente, orderCount/lastAccountId/lastBank
  // quedaban CONGELADOS para siempre en el valor de la primera vez que se le
  // reconoció, porque el saludo aquí "adelantaba" el nombre antes de que el
  // pago (y el seller_payed real) ocurriera. El saludo usa `known.realName`
  // directo (variable local, ver arriba) — no necesita cs.realName.

  // Si ya pidió algo puntual antes de verificar (ej. "mándame 3 cuentas"),
  // eso manda por sobre el ofrecimiento de "misma cuenta de la vez pasada"
  // — es una instrucción explícita y nueva del comprador.
  if (firstMsg && matchWantsAccount(firstMsg)) {
    const wantsMultiple = matchWantsMultipleAccounts(firstMsg);
    const greeting = `${hello} Ya te paso ${wantsMultiple ? "las cuentas que necesites" : "la cuenta"} — antes dime: ¿transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.`;
    const sent = await sendAndTrack(client, exchange, order.orderNumber, cs, greeting, createdAtTs);
    if (sent) {
      await updateState(cs.id, "awaiting_account_type", { isCompany: false, isReturning });
    }
    return;
  }

  // Cliente conocido con una cuenta puntual de la vez pasada (no un pago
  // dividido — ver el "if" en la captura de identidad) — se le ofrece
  // directo en vez de repetirle personal/empresa desde cero. Pedido
  // explícito del usuario: "que no sea la misma pregunta siempre".
  //
  // orderCount >= 2 es a propósito (bug real confirmado en vivo, jul 2026):
  // el apodo enmascarado que vemos ANTES del pago (ej. "Ron***") solo trae
  // 3 letras — cualquier nombre chileno común (Ronald, José, María...)
  // parece "único" la PRIMERA vez que aparece en la tabla, aunque en
  // realidad muchas personas distintas compartan ese mismo comienzo. Un
  // comprador nuevo (Carrillo Ramírez Ronald Alejandro) recibió la oferta
  // de "misma cuenta" de OTRO Ronald (Mamani Arispe) visto horas antes,
  // porque en ese momento solo había UNA identidad con ese prefijo — nada
  // ambiguo todavía, pero tampoco confiable. Exigir 2+ compras confirmadas
  // en esa identidad (no solo 1) reduce ese riesgo — el saludo por nombre
  // (arriba) se mantiene desde la 1ra, solo esta oferta puntual de cuenta
  // exige más evidencia.
  if (known?.lastAccountId && known.orderCount >= 2) {
    const ad = findMatchingAd(activeAds, order);
    const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
    const prevAccount = allAccounts.find((a: any) => a.id === known.lastAccountId);
    if (prevAccount) {
      const greeting = `${hello} ¿Vas a transferir a la misma cuenta de la última vez (${known.lastBank})? Avísame si necesitas que te la reenvíe, o si prefieres usar otra cuenta.`;
      const sent = await sendAndTrack(client, exchange, order.orderNumber, cs, greeting, createdAtTs);
      if (sent) {
        await updateState(cs.id, "awaiting_previous_account", {
          isCompany: known.lastIsCompany,
          isReturning,
          previousBank: known.lastBank,
          chosenAccountIds: [known.lastAccountId],
        });
      }
      return;
    }
  }

  const greeting = buildInitialGreeting(isReturning, name);
  const sent = await sendAndTrack(client, exchange, order.orderNumber, cs, greeting, createdAtTs);
  if (sent) {
    await updateState(cs.id, "awaiting_account_type", { isCompany: false, isReturning });
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

  // Pedido explícito del usuario (jul 2026): un "ok"/"dale"/"listo" puro es
  // solo un reconocimiento de lo que YA se dijo, no una pregunta ni una
  // respuesta a algo pendiente — un operador humano no le contestaría nada.
  // Confirmado en vivo: el respaldo de IA (que responde a TODO mensaje que
  // no calza con nada) le devolvía una pregunta nueva cada vez que la
  // compradora escribía "ok", sonando repetitivo. Se corta ANTES de llegar
  // a la IA (gratis, sin latencia) — no cuenta como reintento ni cambia el
  // estado, solo se ignora en silencio.
  if (isPureAcknowledgment(textLower)) return;

  switch (cs.state) {
    case "awaiting_account_type": {
      const opt = matchOption(textLower, 2);
      // Se resuelve la intención por palabras clave primero (gratis, sin
      // latencia) — SOLO si eso no da nada claro se consulta a la IA como
      // respaldo (ver chat-brain.ts). La IA nunca decide qué cuenta o monto
      // mandar, solo dice cuál de estas mismas ramas usar.
      let resolvedIntent: "empresa" | "personal" | "reports_problem" | "wants_account" | null = null;
      if (opt === 2 || textLower.includes("empresa") || matchERUT(textLower)) resolvedIntent = "empresa";
      else if (opt === 1 || textLower.includes("personal")) resolvedIntent = "personal";
      else if (matchProblemType(textLower) === "not_working") resolvedIntent = "reports_problem";
      else if (matchWantsAccount(textLower)) resolvedIntent = "wants_account";

      let aiFollowUp: string | undefined;
      if (!resolvedIntent) {
        const ai = await classifyIntent({
          state: "awaiting_account_type",
          text: text,
          validIntents: ["personal", "empresa", "wants_account", "reports_problem", "unclear"],
          context: "El bot ya le preguntó al comprador si transfiere desde cuenta personal o empresa, con un menú 1) Personal 2) Empresa.",
        });
        if (ai) {
          // followUpText se guarda SIEMPRE (incluso si intent es "unclear")
          // para poder responder algo natural en vez de "No entendí" si
          // ninguna rama de abajo termina resolviendo nada.
          aiFollowUp = ai.followUpText;
          if (ai.intent !== "unclear") {
            resolvedIntent = ai.intent as any;
            await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
          }
        }
      }

      if (resolvedIntent === "empresa") {
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
          await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "awaiting_previous_account", { isCompany: true, isReturning: true, erutRequested: true, previousBank: history.bank, chosenAccountIds: [history.accountId], retryCount: 0 });
        } else if (accounts.length === 1) {
          const acct = accounts[0];
          const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, { ...cs, isCompany: true }, acct);
          if (sent) await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
        } else {
          const pending = (cs.pendingFirstMsg || "").toLowerCase();
          const named = pending ? matchBank(pending, allAccounts) : null;
          if (pending && matchWantsMultipleAccounts(pending)) {
            const msg = erutNote + "\n\nEstas son nuestras cuentas disponibles:\n\n" +
              accounts.map((a: any, i: number) => `--- Cuenta ${i + 1} ---\n${formatSingleAccount(a)}`).join("\n\n") +
              "\n\nCuando realices cada pago:\n- Marca \"Pagado\" en la orden\n- Envía los comprobantes aquí en el chat";
            await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "account_sent", { isCompany: true, erutRequested: true, chosenBank: accounts.map((a: any) => a.bank).join(", "), chosenAccountIds: accounts.map((a: any) => a.id), retryCount: 0, pendingFirstMsg: null });
          } else if (named) {
            const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, { ...cs, isCompany: true }, named);
            if (sent) await updateState(cs.id, "account_sent", { isCompany: true, erutRequested: true, chosenBank: named.bank, chosenAccountIds: [named.id], retryCount: 0, pendingFirstMsg: null });
          } else {
            const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
            const msg = erutNote + "\n\n¿A qué cuenta deseas transferir?\n" + choices;
            await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "awaiting_bank_choice", { isCompany: true, erutRequested: true, retryCount: 0, pendingBankMenuIds: accounts.map((a: any) => a.id) });
          }
        }
      } else if (resolvedIntent === "personal") {
        // Personal flow
        const ad = findMatchingAd(activeAds, order);
        const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const accounts = pickDefaultAccountsPerBank(allAccounts);

        // Check if returning customer
        const history = cs.counterparty ? await getBuyerHistory(tenantId, exchange, cs.counterparty) : null;
        const previousAccountStillAvailable = history && allAccounts.some((a: any) => a.id === history.accountId);

        if (previousAccountStillAvailable) {
          const msg = `¿Quieres que te envíe la cuenta de ${history.bank} de nuevo, o vas a transferir a la misma cuenta donde ya pagaste antes?\n  1) Envíame la cuenta\n  2) Voy a transferir a la misma cuenta\n\nResponde 1 o 2.`;
          await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "awaiting_previous_account", { isReturning: true, previousBank: history.bank, chosenAccountIds: [history.accountId], retryCount: 0 });
        } else if (accounts.length === 1) {
          // New customer, single account: send directly
          const acct = accounts[0];
          const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, cs, acct);
          if (sent) await updateState(cs.id, "account_sent", { chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
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
            await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "account_sent", { chosenBank: accounts.map((a: any) => a.bank).join(", "), chosenAccountIds: accounts.map((a: any) => a.id), retryCount: 0, pendingFirstMsg: null });
          } else if (named) {
            const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, { ...cs, isCompany: false }, named);
            if (sent) await updateState(cs.id, "account_sent", { chosenBank: named.bank, chosenAccountIds: [named.id], retryCount: 0, pendingFirstMsg: null });
          } else {
            // New customer, multiple accounts: ask
            await sendThenTransition(client, exchange, order.orderNumber, cs,
              `¿A qué cuenta deseas transferir?\n${accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n")}\n\nTambién puedes escribir el nombre del banco.`,
              "awaiting_bank_choice", { isCompany: false, retryCount: 0, pendingBankMenuIds: accounts.map((a: any) => a.id) }
            );
          }
        }
      } else if (resolvedIntent === "reports_problem") {
        // Reclamo genérico ("no me deja", "no funciona", "no puedo") antes
        // de responder personal/empresa. Bug real confirmado en vivo (jul
        // 2026): "No me deja la cuenta" se leía como si hubiera elegido la
        // opción 2 (Empresa) — el comprador terminó con un pedido de ERUT
        // que nunca hizo. Ahora, en vez de asumir nada, se pregunta qué pasó
        // para entender la causa real y poder ayudar. Si la IA ya redactó
        // una pregunta de seguimiento acorde, se usa esa; si no, una fija.
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          aiFollowUp || pick([
            "Cuéntame, ¿qué problema tuviste? Así te ayudo a resolverlo.",
            "¿Qué pasó exactamente? Cuéntame para ver cómo lo solucionamos.",
          ]),
          "awaiting_account_type", { retryCount: 0 }
        );
      } else if (resolvedIntent === "wants_account") {
        // Pidió la cuenta pero no dijo personal/empresa — esa pregunta NUNCA
        // se salta. Se reconoce el pedido en el mismo mensaje y se guarda
        // (pendingFirstMsg) para resolver directo apenas responda 1 o 2,
        // sin otro paso intermedio de "¿qué banco?".
        const wantsMultiple = matchWantsMultipleAccounts(textLower);
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          `Claro, ya te paso ${wantsMultiple ? "las cuentas que necesites" : "la cuenta"} — antes dime: ¿transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.`,
          "awaiting_account_type", { pendingFirstMsg: textLower, retryCount: 0 }
        );
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
        } else {
          // Pedido explícito del usuario: el bot nunca debe sonar robótico
          // con "No entendí" — si la IA redactó una respuesta natural, se
          // usa esa (reconoce lo que dijo y retoma la pregunta); el texto
          // fijo queda solo como último respaldo si la IA no respondió.
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            aiFollowUp || "No entendí. ¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa\n\nResponde 1 o 2.",
            "awaiting_account_type", { retryCount }
          );
        }
      }
      break;
    }

    case "awaiting_previous_account": {
      // Sin menú numerado a propósito — es la conversación natural de
      // "¿misma cuenta de la última vez?", no otro más de los formularios
      // rígidos. Se interpreta: 1) pide que se la reenvíe → mandar la cuenta
      // de nuevo; 2) confirma que sigue siendo esa, sin pedir reenvío →
      // avisar y esperar el pago; 3) pide otra cuenta → mostrar el menú de
      // bancos (pedido explícito del usuario). Si nada de esto calza,
      // respaldo de IA antes de retroceder a "No entendí".
      const ad = findMatchingAd(activeAds, order);
      const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
      const namedDifferentBank = matchBank(textLower, allAccounts);
      const isSameAccountByName = namedDifferentBank && namedDifferentBank.id === (cs.chosenAccountIds?.[0] || 0);

      const wantsResend = matchWantsAccount(textLower) || textLower.includes("reenv") || textLower.includes("envía") || textLower.includes("mandame") || textLower.includes("mándame");
      const wantsDifferent = !isSameAccountByName && (namedDifferentBank || textLower.includes("otra") || textLower.includes("distinta") || textLower.includes("cambiar") || textLower.includes("diferente"));
      const confirmsSame = !wantsDifferent && (matchOption(textLower, 2) === 1 || textLower.includes("misma") || textLower.includes("si") || textLower.includes("sí") || isSameAccountByName);

      let resolved: "resend" | "confirm_no_resend" | "different_named" | "different_menu" | null = null;
      if (namedDifferentBank && !isSameAccountByName) resolved = "different_named";
      else if (wantsResend) resolved = "resend";
      else if (wantsDifferent) resolved = "different_menu";
      else if (confirmsSame) resolved = "confirm_no_resend";

      let aiFollowUp: string | undefined;
      if (!resolved) {
        const ai = await classifyIntent({
          state: "awaiting_previous_account",
          text,
          validIntents: ["resend", "confirm_no_resend", "different_menu", "unclear"],
          context: `Se le preguntó al comprador si va a transferir a la misma cuenta que usó la vez pasada (${cs.previousBank || "una cuenta anterior"}), avisándole que puede pedir que se la reenvíen o pedir otra cuenta distinta.`,
        });
        if (ai) {
          aiFollowUp = ai.followUpText;
          if (ai.intent !== "unclear") {
            resolved = ai.intent as any;
            await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
          }
        }
      }

      if (resolved === "resend" || resolved === "confirm_no_resend") {
        // Ambos casos son la MISMA cuenta que la vez pasada — la única
        // diferencia es si hace falta reenviar los datos o no.
        const acct = allAccounts.find((a: any) => a.id === (cs.chosenAccountIds?.[0] || 0)) || allAccounts[0];
        let sentPrev: boolean;
        if (resolved === "resend") {
          sentPrev = await sendAccountWithErutNote(tenantId, exchange, client, order, cs, acct, { skipIntro: true });
        } else {
          let msg = "Perfecto, cuando realices el pago marca \"Pagado\" en la orden y envía el comprobante por aquí.";
          if (cs.isCompany) msg += "\n\nRecuerda adjuntar el ERUT junto con el comprobante para emitir la factura.";
          sentPrev = await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
        }
        if (sentPrev) await updateState(cs.id, "account_sent", { chosenBank: acct.bank, chosenAccountIds: [acct.id], retryCount: 0 });
      } else if (resolved === "different_named") {
        const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, cs, namedDifferentBank);
        if (sent) await updateState(cs.id, "account_sent", { chosenBank: namedDifferentBank.bank, chosenAccountIds: [namedDifferentBank.id], retryCount: 0 });
      } else if (resolved === "different_menu") {
        const accounts = pickDefaultAccountsPerBank(allAccounts);
        const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          `Claro, ¿a qué banco prefieres transferir esta vez?\n${choices}\n\nTambién puedes escribir el nombre del banco.`,
          "awaiting_bank_choice", { retryCount: 0, pendingBankMenuIds: accounts.map((a: any) => a.id) }
        );
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            aiFollowUp || `No entendí. ¿Vas a transferir a la misma cuenta de la última vez (${cs.previousBank || "la anterior"}), o prefieres otra cuenta?`,
            "awaiting_previous_account", { retryCount }
          );
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
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          "No entendí. ¿Transfieres desde cuenta personal o empresa?\n  1) Personal\n  2) Empresa",
          "awaiting_account_type", { retryCount }
        );
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
      // Bug real confirmado en vivo (jul 2026): el orden de los bancos se
      // reordenó en la base de datos MIENTRAS un comprador tenía este menú
      // pendiente de responder — su "2" (pensado para el banco que vio en
      // pantalla) se interpretó contra el orden NUEVO, resultando en un
      // banco distinto al que realmente eligió. Si el menú que se le mostró
      // quedó "fijado" (pendingBankMenuIds), se usa ESE orden exacto para
      // interpretar el número — nunca se re-deriva fresco de la base de datos.
      const accounts = resolveMenuAccounts(cs.pendingBankMenuIds, allAccounts) || pickDefaultAccountsPerBank(allAccounts);
      const opt = matchOption(textLower, accounts.length);
      // El número del menú solo elige entre las cuentas por defecto (nunca la
      // vista); pero si escribe texto libre, matchBank sí puede reconocer una
      // cuenta oculta (ej. "vista", o los últimos dígitos) si la pide directo.
      const chosen = opt ? accounts[opt - 1] : matchBank(textLower, allAccounts);

      let wantsAll = matchWantsMultipleAccounts(textLower);
      // Bug real confirmado en vivo (jul 2026): un comprador dijo "no me
      // permite hacer la transferencia" justo en este punto (antes de elegir
      // banco) y el bot respondió "No entendí" — nunca intentó entender CUÁL
      // era el problema, así que agotó los reintentos y cerró con "voy a
      // comunicarte con un asesor" (que nunca llegó), y el comprador
      // canceló. matchProblemType YA reconoce esto como "limit" (revisa
      // "permite"/"deja"/etc.) — solo faltaba consultarlo acá.
      let resolvedProblem: "limit" | "not_working" | null = null;
      let aiFollowUp: string | undefined;
      if (!chosen && !wantsAll) {
        const problemType = matchProblemType(textLower);
        resolvedProblem = problemType === "limit" ? "limit" : problemType === "not_working" ? "not_working" : null;

        // Bug real confirmado en vivo (jul 2026): a diferencia de
        // awaiting_account_type y account_sent, este estado nunca supo
        // reconocer "mándame las 3 cuentas" — solo entendía UN banco
        // puntual, así que terminaba en "No entendí" y cerraba la
        // conversación con un asesor que nunca llegó. Se agrega el mismo
        // respaldo de IA que ya tienen los otros dos puntos (y ahora también
        // cubre "reporta un problema", no solo "quiere todas las cuentas").
        if (!resolvedProblem) {
          const ai = await classifyIntent({
            state: "awaiting_bank_choice",
            text,
            validIntents: ["wants_all_accounts", "limit", "not_working", "unclear"],
            context: `Se le pidió al comprador que elija un banco de esta lista para transferir: ${accounts.map((a: any) => a.bank).join(", ")}.`,
          });
          if (ai) {
            aiFollowUp = ai.followUpText;
            if (ai.intent === "wants_all_accounts") {
              wantsAll = true;
              await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "wants_all_accounts"`);
            } else if (ai.intent === "limit" || ai.intent === "not_working") {
              resolvedProblem = ai.intent;
              await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
            }
          }
        }
      }

      if (chosen) {
        const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, cs, chosen);
        if (sent) await updateState(cs.id, "account_sent", { chosenBank: chosen.bank, chosenAccountIds: [chosen.id], retryCount: 0 });
      } else if (wantsAll) {
        const erutNote = cs.isCompany ? "Al realizar el pago, por favor adjunta el ERUT junto con el comprobante para emitir la factura.\n\n" : "";
        const msg = erutNote + "Estas son nuestras cuentas disponibles:\n\n" +
          accounts.map((a: any, i: number) => `--- Cuenta ${i + 1} ---\n${formatSingleAccount(a)}`).join("\n\n") +
          "\n\nCuando realices cada pago:\n- Marca \"Pagado\" en la orden\n- Envía los comprobantes aquí en el chat";
        await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "account_sent", { chosenBank: accounts.map((a: any) => a.bank).join(", "), chosenAccountIds: accounts.map((a: any) => a.id), retryCount: 0 });
      } else if (resolvedProblem === "limit") {
        // Pregunta por límite (ej. "no me permite hacer la transferencia",
        // "solo me deja 250mil") — se ofrece dividir el pago, igual que en
        // account_sent. Todavía no eligió cuenta, así que si ya mencionó un
        // monto se puede repartir directo sin preguntar de nuevo.
        const amount = extractAmount(textLower);
        if (amount > 0 && cs.totalAmount) {
          await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            pick([
              "Sin problema, podemos dividir el pago en 2 partes. ¿Cuánto te permite transferir tu banco por vez?",
              "No hay problema, lo dividimos en 2 pagos. ¿Cuál es el máximo que te deja transferir tu banco?",
            ]),
            "awaiting_limit_amount", { retryCount: 0 }
          );
        }
      } else if (resolvedProblem === "not_working") {
        // Todavía no se envió ninguna cuenta en esta orden, así que no hay
        // "otra cuenta" que ofrecer como en handleTransferFails — se le
        // manda la primera disponible directo.
        const next = accounts[0];
        if (next) {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            "Entiendo. Probemos con esta cuenta:\n\n" + formatSingleAccount(next) + "\n\nIntenta con esta y me avisas.",
            "account_sent", { chosenBank: next.bank, chosenAccountIds: [next.id], retryCount: 0, transferFailCount: (cs.transferFailCount || 0) + 1 }
          );
        } else {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
        }
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
        } else {
          const choices = accounts.map((a: any, i: number) => `  ${i + 1}) ${a.bank}`).join("\n");
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            aiFollowUp || `No entendí. Por favor elige el banco para tu depósito:\n${choices}\n\nResponde el número o escribe el nombre del banco.`,
            "awaiting_bank_choice", { retryCount, pendingBankMenuIds: accounts.map((a: any) => a.id) }
          );
        }
      }
      break;
    }

    // Generic account_sent handler: monitor for problems, ERUT, third-party, etc.
    case "account_sent": {
      // Bug real confirmado en vivo (jul 2026): un comprador mandó "personal"
      // y, un instante después, "sí" suelto (probablemente reforzando su
      // respuesta anterior, sin ninguna pregunta de sí/no pendiente en este
      // estado) — el bot lo tomó como un mensaje nuevo y le preguntó "¿ya
      // transferiste?" de la nada. A diferencia de otros estados (donde
      // "sí"/"no" SÍ responden una pregunta real, ej. awaiting_company_type),
      // account_sent no tiene ninguna pregunta de sí/no pendiente — un
      // "sí"/"no" suelto acá es siempre solo un reconocimiento vacío.
      const bareYesNo = ["si", "sí", "no"].includes(textLower.replace(/[.,!?¡¿]+$/g, "").trim());
      if (bareYesNo) break;

      if (matchThirdParty(textLower)) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Lo siento, la transferencia debe ser desde una cuenta a nombre del titular de la orden. No aceptamos depósitos de terceros.\n\n¿Tienes otra forma de realizar el pago?"
        );
      } else if (matchERUT(textLower) || matchCompanyType(textLower) === true) {
        if (cs.isCompany || matchCompanyType(textLower) === true) {
          // Bug real confirmado en vivo (jul 2026): cada vez que el comprador
          // volvía a mencionar "empresa" en un mensaje distinto (ej. contando
          // desde qué cuenta iba a transferir), el bot repetía el pedido
          // completo del ERUT de nuevo — incluso después de que el operador
          // ya le había dicho manualmente al comprador que lo ignorara
          // porque ya lo habían recibido. Ahora solo se pide la primera vez.
          if (!cs.erutRequested) {
            await sendThenTransition(client, exchange, order.orderNumber, cs,
              "Entendido, es cuenta empresa. Necesitamos que nos envíes el ERUT para validar la titularidad y emitir la factura correspondiente.\n\n¿Puedes enviarlo por aquí?",
              "account_sent", { isCompany: true, erutRequested: true, retryCount: 0 }
            );
          }
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            "Entendido. Si la transferencia es desde cuenta empresa, necesitamos el ERUT. ¿Es tu caso?\n  1) Sí, es empresa\n  2) No, es personal",
            "awaiting_company_type", { retryCount: 0 }
          );
        }
      } else {
        // Acá es exactamente el caso "el comprador pregunta directo por una
        // cuenta específica" — incluye las ocultas (vista) a propósito.
        const ad = findMatchingAd(activeAds, order);
        const accounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
        const chosen = matchBank(textLower, accounts);
        const problemType = matchProblemType(textLower);
        let resolvedProblem: "limit" | "not_working" | null =
          problemType === "limit" ? "limit" : (problemType === "not_working" || textLower.includes("no me")) ? "not_working" : null;

        // Si no se pudo reconocer un banco ni un problema por palabras clave,
        // se consulta a la IA como respaldo antes de quedarse en silencio
        // (antes de este cambio, este caso simplemente no respondía nada).
        let aiFollowUp: string | undefined;
        if (!chosen && !resolvedProblem) {
          const ai = await classifyIntent({
            state: "account_sent",
            text,
            validIntents: ["limit", "not_working", "unclear"],
            context: "Ya se le mandaron los datos de una cuenta bancaria al comprador para que pague. Está escribiendo algo relacionado con ese pago.",
          });
          if (ai) {
            aiFollowUp = ai.followUpText;
            if (ai.intent !== "unclear") {
              resolvedProblem = ai.intent as any;
              await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
            }
          }
        }

        // Bug real confirmado en vivo (jul 2026): un comprador mandó "1"
        // (reforzando su respuesta anterior de "personal") justo cuando el
        // bot ya había avanzado a pedir el banco — ese "1" se interpretó
        // como elegir el primer banco del menú, mandando la cuenta. Segundos
        // después llegó su mensaje real ("banco de chile", el mismo banco
        // por coincidencia) y como el estado ya era account_sent, se
        // volvió a mandar la MISMA cuenta de nuevo. Si ya se mandó
        // exactamente esta cuenta, no se repite todo el bloque de datos.
        const alreadySentThisAccount = chosen && Array.isArray(cs.chosenAccountIds) && cs.chosenAccountIds.length === 1 && cs.chosenAccountIds[0] === chosen.id;
        if (alreadySentThisAccount) {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "Sí, esos son los datos que ya te envié arriba. Cualquier duda, avísame."
          );
        } else if (chosen) {
          const sent = await sendAccountWithErutNote(tenantId, exchange, client, order, cs, chosen);
          if (sent) await updateState(cs.id, "account_sent", { chosenBank: chosen.bank, chosenAccountIds: [chosen.id], retryCount: 0 });
        } else if (resolvedProblem === "limit") {
          // Pregunta proactiva por el límite de su banco (ej: "solo me deja
          // 500mil, ¿puedo hacer 2 pagos?") — NO es un reclamo de que la
          // transferencia falló, así que no debe caer en handleTransferFails
          // (eso solo ofrece OTRA cuenta, no responde la pregunta real).
          const amount = extractAmount(textLower);
          if (amount > 0 && cs.totalAmount) {
            await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
          } else {
            await sendThenTransition(client, exchange, order.orderNumber, cs,
              pick([
                "Sí, puedes hacer el pago en 2 partes sin problema. ¿Cuánto te permite transferir tu banco por vez?",
                "Claro, no hay problema en dividirlo en 2 pagos. ¿Cuál es el máximo que te deja transferir tu banco?",
              ]),
              "awaiting_limit_amount", { retryCount: 0 }
            );
          }
        } else if (resolvedProblem === "not_working") {
          await handleTransferFails(tenantId, exchange, client, order, cs, activeAds, textLower, label);
        } else if (aiFollowUp) {
          // Antes de este fix, un mensaje que no era ni banco ni problema
          // (ej. un comentario aparte) se quedaba sin ninguna respuesta —
          // pedido explícito del usuario: el bot siempre debe dar
          // continuidad natural, nunca dejar un mensaje en silencio.
          await sendAndTrack(client, exchange, order.orderNumber, cs, aiFollowUp);
        }
      }
      break;
    }

    case "awaiting_company_type": {
      const opt = matchOption(textLower, 2);
      let companyType = opt === 1 ? true : opt === 2 ? false : null;
      if (companyType === null) companyType = matchCompanyType(textLower);

      let aiFollowUp: string | undefined;
      if (companyType === null) {
        const ai = await classifyIntent({
          state: "awaiting_company_type",
          text,
          validIntents: ["empresa", "personal", "unclear"],
          context: "Se le preguntó al comprador si la transferencia es desde cuenta empresa o personal, con un menú 1) Empresa 2) Personal.",
        });
        if (ai) {
          aiFollowUp = ai.followUpText;
          if (ai.intent === "empresa") companyType = true;
          else if (ai.intent === "personal") companyType = false;
          if (ai.intent !== "unclear") {
            await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
          }
        }
      }

      if (companyType === true) {
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          "Entendido. Por favor adjunta el ERUT de la empresa para validar la información y emitir la factura.\n\nLos datos de la cuenta ya están disponibles más arriba.",
          "account_sent", { isCompany: true, erutRequested: true, retryCount: 0 }
        );
      } else if (companyType === false) {
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          "Perfecto, es cuenta personal. Los datos de la cuenta ya están disponibles más arriba.",
          "account_sent", { isCompany: false, retryCount: 0 }
        );
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor. Un momento.", { retryCount });
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            aiFollowUp || "No entendí. ¿La transferencia es desde cuenta empresa o personal?\n  1) Empresa\n  2) Personal\n\nResponde 1 o 2.",
            "awaiting_company_type", { retryCount }
          );
        }
      }
      break;
    }

    // Rediseñado por pedido explícito del usuario (jul 2026): pregunta
    // natural de sí/no en vez de menú numerado, y este estado NO tiene
    // reintentos ni cierre — es un aviso de cortesía, no un paso
    // bloqueante. Si la respuesta no es clara, simplemente no se hace nada
    // (se sigue esperando; el aviso ya se mandó una sola vez).
    case "awaiting_problem": {
      const resumeState = (cs.preInterruptState as ChatState) || "account_sent";
      const problemType = matchProblemType(textLower);
      // \b no sirve acá para detectar "sí" al inicio: la tilde ("í") no
      // cuenta como carácter de palabra para \b en JS, así que "sí," o "sí"
      // solo (fin de texto) nunca hacían boundary — normalizamos tildes y
      // comparamos la primera palabra completa en vez de un prefijo con \b.
      const firstWord = textLower
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[.,!?¡¿]/g, " ")
        .trim()
        .split(/\s+/)[0] || "";
      const saysYes = firstWord === "si";
      const saysNo = firstWord === "no";

      if (problemType === "limit") {
        // Dijo que sí (implícito) Y describió un problema de límite en el
        // mismo mensaje (ej. "sí por favor, el banco solo me deja 200") —
        // se reconoce la extensión Y se avanza directo con el problema
        // puntual, sin preguntar de nuevo qué tipo de problema es.
        await sendAndTrack(client, exchange, order.orderNumber, cs, "Entendido, vamos a solicitar la extensión de tiempo.");
        const amount = extractAmount(textLower);
        if (amount > 0 && cs.totalAmount) {
          await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            "¿Cuál es el máximo que te permite transferir tu banco?",
            "awaiting_limit_amount", { retryCount: 0, preInterruptState: null }
          );
        }
      } else if (problemType === "not_working") {
        await sendAndTrack(client, exchange, order.orderNumber, cs, "Entendido, vamos a solicitar la extensión de tiempo.");
        await handleTransferFails(tenantId, exchange, client, order, cs, activeAds, textLower, label);
      } else if (saysYes) {
        await sendThenTransition(client, exchange, order.orderNumber, cs,
          "Perfecto, vamos a solicitar la extensión de tiempo.",
          resumeState, { retryCount: 0, preInterruptState: null }
        );
      } else if (saysNo) {
        // Pedido explícito del usuario: si dice que no, se deja así — sin
        // mensaje de más, solo se retoma la conversación donde iba.
        await updateState(cs.id, resumeState, { preInterruptState: null });
      }
      // Respuesta ambigua (ni sí, ni no, ni describe un problema): no se
      // hace nada, a propósito — sin reintentos ni cierre.
      break;
    }

    case "awaiting_limit_amount": {
      let amount = extractAmount(textLower);
      let aiFollowUp: string | undefined;
      if (!(amount > 0)) {
        // Si no hay un monto reconocible por regex, se consulta a la IA solo
        // para EXTRAER el número que el comprador haya mencionado en texto
        // libre (ej. "como 200 lucas") — la IA nunca decide qué hacer con
        // ese monto, solo lo extrae; offerSplitPayment (código fijo) es
        // quien sigue decidiendo el reparto real.
        const ai = await classifyIntent({
          state: "awaiting_limit_amount",
          text,
          validIntents: ["gives_amount", "unclear"],
          context: "Se le preguntó al comprador cuál es el monto máximo que su banco le permite transferir.",
        });
        if (ai) {
          aiFollowUp = ai.followUpText;
          if (ai.intent === "gives_amount" && ai.extractedAmountClp && ai.extractedAmountClp > 0) {
            amount = ai.extractedAmountClp;
            await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA extrajo monto ${amount} de "${textLower.slice(0, 60)}"`);
          }
        }
      }

      if (amount > 0 && cs.totalAmount) {
        await offerSplitPayment(tenantId, exchange, client, order, cs, amount, label);
      } else {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          await sendThenClose(client, exchange, order.orderNumber, cs, "Voy a comunicarte con un asesor.", { retryCount });
        } else {
          await sendThenTransition(client, exchange, order.orderNumber, cs,
            aiFollowUp || "No entendí el monto. ¿Cuánto te permite transferir tu banco? (ej: 150000)",
            "awaiting_limit_amount", { retryCount }
          );
        }
      }
      break;
    }

    // Antes de este fix, este estado no tenía NINGÚN caso — si el comprador
    // escribía algo mientras esperábamos el comprobante, el bot se quedaba
    // callado. Caso real confirmado en vivo: pagó, avisó "por problemas de
    // señal no me carga el comprobante, pagué a Banco de Chile" — el
    // operador tuvo que responder a mano. Nota: prioriza SIEMPRE el banco
    // que la persona menciona en el mensaje sobre el que habíamos guardado
    // (chosenBank) — puede haber elegido un banco y transferido a otro.
    case "awaiting_comprobant": {
      const ad = findMatchingAd(activeAds, order);
      const allAccounts = await getAccountsForAd(tenantId, exchange, ad, label, { includeHidden: true });
      const namedBank = matchBank(textLower, allAccounts);
      const opNumberMatch = textLower.match(/\b\d{6,}\b/);
      const mentionsUploadIssue = matchProblemType(textLower) === "not_working" ||
        ["no carga", "no me carga", "no sube", "no puedo subir", "no puedo enviar", "no puedo mandar", "no puedo cargar", "señal", "error al subir"].some(k => textLower.includes(k));
      const knownBank = cs.chosenBank && !String(cs.chosenBank).includes(",") ? cs.chosenBank : null;
      const bankRef = namedBank?.bank || (mentionsUploadIssue ? knownBank : null);

      if (bankRef) {
        const msg = `Entendido, vamos a validar tu pago por ${bankRef}. ¿Nos puedes dar el número de operación de la transferencia para agilizar la validación?`;
        if (namedBank) {
          await sendThenTransition(client, exchange, order.orderNumber, cs, msg, "awaiting_comprobant", { chosenBank: namedBank.bank });
        } else {
          await sendAndTrack(client, exchange, order.orderNumber, cs, msg);
        }
      } else if (mentionsUploadIssue) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "No hay problema. ¿A qué banco realizaste el pago? Así podemos validarlo aunque no puedas enviar el comprobante."
        );
      } else if (opNumberMatch) {
        await sendAndTrack(client, exchange, order.orderNumber, cs,
          "Gracias, quedó registrado el número de operación. Vamos a validar tu pago."
        );
      } else {
        const ai = await classifyIntent({
          state: "awaiting_comprobant",
          text,
          validIntents: ["issue_uploading", "mentions_bank", "gives_op_number", "unclear"],
          context: "Se le pidió al comprador el comprobante de pago y todavía no lo ha enviado.",
        });
        if (ai?.intent && ai.intent !== "unclear") {
          await sendAndTrack(client, exchange, order.orderNumber, cs,
            "Entendido, sin problema. ¿A qué banco realizaste el pago? Con eso y el número de operación podemos validarlo aunque no puedas enviar el comprobante."
          );
          await logMsg(tenantId, exchange, `[Chat] ${order.orderNumber}: IA clasificó "${textLower.slice(0, 60)}" como "${ai.intent}"`);
        } else if (ai?.followUpText) {
          // Antes de este fix, un mensaje que no calzaba con nada acá se
          // quedaba en silencio total (bug ya documentado antes) — pedido
          // explícito del usuario: el bot nunca deja un mensaje sin
          // respuesta, aunque sea solo un comentario aparte.
          await sendAndTrack(client, exchange, order.orderNumber, cs, ai.followUpText);
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
    await sendThenTransition(client, exchange, order.orderNumber, cs,
      "Aquí tienes otra cuenta para intentar:\n\n" +
      formatSingleAccount(next) +
      "\n\nIntenta con esta y me avisas.",
      "account_sent", {
        chosenAccountIds: [...alreadySentIds, next.id],
        chosenBank: next.bank,
        retryCount: 0,
        transferFailCount: fails,
      }
    );
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
    await sendThenTransition(client, exchange, orderNumber, cs, msg, "completed", { completedAt: new Date() });
  } else {
    await client.sendChatMessage(orderNumber, msg);
    await updateState(cs.id, "completed", { completedAt: new Date() });
  }
}

/* ─── Helpers ─────────────────────────────────────────────────── */

async function sendAccountWithErutNote(
  tenantId: number,
  exchange: string,
  client: any,
  order: any,
  cs: any,
  acct: any,
  opts: { skipIntro?: boolean } = {}
): Promise<boolean> {
  const erutNote = cs.isCompany
    ? "\n\nAl ser cuenta empresa, necesitamos el ERUT para validar la titularidad y emitir la factura. Por favor adjúntalo cuando puedas."
    : "";
  // Pedido explícito del usuario (jul 2026): los datos bancarios se mandan
  // en 3 mensajes separados (intro, datos, instrucciones) en vez de un solo
  // bloque largo — se siente más como una persona escribiendo que como un
  // volcado de texto. El mensaje 2 (datos) debe ser SOLO la cuenta, sin
  // ningún otro texto — el aviso de ERUT (si es empresa) va pegado al
  // mensaje 3, no acá.
  // opts.skipIntro: para un cliente frecuente que confirma "misma cuenta de
  // la última vez", el mensaje de intro ("te envío la cuenta para que
  // copies y pegues") es puro relleno — ya sabe cómo funciona. Solo se usa
  // acá, nunca para alguien que recibe la cuenta por primera vez en la orden.
  //
  // Bug real confirmado en vivo (jul 2026): el mensaje 1 usa humanDelay()
  // completo (2-5s, es una respuesta nueva al comprador), pero los
  // mensajes 2 y 3 usan shortDelay() (0.7-1.3s) — son continuación del
  // mismo mensaji 1, no respuestas nuevas. Con 3× humanDelay completo esta
  // función se acercaba/superaba el límite de 20s de processOrderLocked
  // (ver esa constante), y el salvavidas de timeout liberaba el lock de la
  // orden mientras el envío seguía en curso — el siguiente ciclo (~15s
  // después) entraba a procesar la MISMA orden en paralelo, causando
  // mensajes duplicados y respuestas cruzadas de verdad confirmadas en 2
  // órdenes reales el mismo día.
  if (!opts.skipIntro) {
    const intro = await sendAndTrack(client, exchange, order.orderNumber, cs,
      "Te envío la cuenta para que copies y pegues en tu banco."
    );
    if (!intro) return false;
  }
  const details = await sendAndTrack(client, exchange, order.orderNumber, cs, formatSingleAccount(acct), undefined, shortDelay);
  if (!details) return false;
  return sendAndTrack(client, exchange, order.orderNumber, cs,
    "Cuando realices el pago:\n- Marca \"Pagado\" en la orden\n- Envía el comprobante aquí en el chat" + erutNote,
    undefined, shortDelay
  );
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

// Antes se procesaba SOLO el mensaje más antiguo sin leer aún (uno por
// ciclo, ~15s cada uno) — un pensamiento partido en 2-3 mensajes seguidos
// (ej. "falabella me deja 700" / "de una" / "voy a dividir") se respondía
// fragmento por fragmento, en ciclos DISTINTOS, perdiendo el hilo completo
// y generando respuestas fuera de contexto a cada parte suelta. Pedido
// explícito del usuario (jul 2026): agrupar TODOS los mensajes nuevos del
// comprador desde el último ciclo en uno solo antes de procesar — se lee
// como una sola idea, no como preguntas separadas.
function findLastClientMsg(msgs: ChatMessage[], sinceTime?: number | null): ChatMessage | null {
  const pending = msgs.filter(m => {
    if (m.self || m.type === "system") return false;
    if (!m.content.trim() && !m.imageUrl) return false;
    if (sinceTime !== null && sinceTime !== undefined && m.createTime <= sinceTime) return false;
    return true;
  });
  if (pending.length === 0) return null;
  if (pending.length === 1) return pending[0];

  const textParts = pending.map(m => m.content?.trim()).filter(Boolean);
  const lastImage = [...pending].reverse().find(m => m.imageUrl)?.imageUrl || null;
  const last = pending[pending.length - 1];
  return {
    id: last.id,
    type: "text",
    content: textParts.join("\n"),
    self: false,
    createTime: last.createTime,
    // Solo se conserva la imagen si NO hay texto en el lote — si hay texto,
    // ese es lo accionable (ver el manejo de solo-imagen más abajo).
    imageUrl: textParts.length === 0 ? lastImage : null,
  };
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

// Pausa corta entre mensajes de UNA MISMA ráfaga (ej. los 3 mensajes de
// sendAccountWithErutNote) — una persona real no espera 2-5s completos
// entre cada parte de algo que ya estaba escribiendo, solo entre una
// respuesta nueva y el mensaje anterior del comprador.
async function shortDelay(): Promise<void> {
  const ms = 700 + Math.floor(Math.random() * 600); // 0.7-1.3s
  await new Promise(r => setTimeout(r, ms));
}

async function sendAndTrack(client: any, exchange: string, orderNo: string, cs: any, msg: string, createdAt?: number, delayFn: () => Promise<void> = humanDelay): Promise<boolean> {
  try {
    await delayFn();
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
  return sendThenTransition(client, exchange, orderNo, cs, msg, "closed", extra);
}

// Mismo principio que sendThenClose mas genérico: solo avanza de estado si
// el mensaje realmente se envió. Bug real confirmado en vivo (jul 2026, otro
// punto distinto al de sendThenClose): el aviso de pago recibido falló por
// WS (ILLEGAL_PARAM) pero el estado igual pasaba a "payment_made" — el
// comprador pagó y preguntó "¿está listo?" sin que el bot nunca confirmara
// haber recibido el aviso, porque el mensaje real nunca llegó.
async function sendThenTransition(client: any, exchange: string, orderNo: string, cs: any, msg: string, newState: ChatState, extra: Record<string, any> = {}, createdAt?: number): Promise<boolean> {
  const sent = await sendAndTrack(client, exchange, orderNo, cs, msg, createdAt);
  if (sent) {
    await updateState(cs.id, newState, extra);
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

  // Bug real confirmado en vivo (jul 2026): con varios mensajes seguidos
  // del comprador combinados en uno solo (ver findLastClientMsg), un "1"
  // puede llegar en su PROPIA línea al final de un mensaje más largo (ej.
  // una explicación + "1" aparte) — parseInt(text) de arriba solo mira el
  // inicio del string completo y nunca encuentra ese "1" perdido más
  // adelante. Se revisa cada línea por separado antes de rendirse, pero
  // solo si esa línea es EXACTAMENTE el número/sí/no (nada más), mismo
  // criterio estricto que arriba.
  if (text.includes("\n")) {
    for (const line of text.split("\n")) {
      const lineTrimmed = line.trim().replace(/[.,!?¡¿]+$/, "");
      const lineNum = parseInt(lineTrimmed);
      if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= max && String(lineNum) === lineTrimmed) return lineNum;
      if (lineTrimmed === "sí" || lineTrimmed === "si" || lineTrimmed === "yes") return 1;
      if (lineTrimmed === "no") return 2;
    }
  }
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

// Solo detecta un mensaje que es ÚNICAMENTE un reconocimiento vacío (nada
// más) — "ok, gracias" o "listo, ¿todo bien?" NO califican (traen algo más).
// A propósito una lista corta y literal, no palabras clave sueltas — un
// falso positivo acá significa ignorar un mensaje real por accidente.
const PURE_ACKNOWLEDGMENT_WORDS = new Set([
  "ok", "oka", "okay", "okey", "dale", "listo", "vale", "va",
  "bueno", "bien", "entendido", "perfecto", "genial", "de acuerdo",
]);
function isPureAcknowledgment(text: string): boolean {
  const cleaned = text.trim().replace(/[.,!?¡¿👍👌✅🙏😊😁🙌]+/gu, "").trim();
  return PURE_ACKNOWLEDGMENT_WORDS.has(cleaned);
}

// "gracias" es distinto de "ok"/"dale" — pedido explícito del usuario: un
// agradecimiento SÍ merece una respuesta (de agradecimiento hacia la
// persona), no silencio. A propósito NO está en PURE_ACKNOWLEDGMENT_WORDS:
// al no calzar con ningún matcher determinístico, cae sola al respaldo de
// IA de cada estado (que ya tiene el contexto de qué se le pidió/mandó),
// para que la respuesta sea cordial y ajustada a POR QUÉ está agradeciendo
// (ver instrucción específica en chat-brain.ts) en vez de una única frase
// fija sin importar el motivo.

function matchProblemType(text: string): string | null {
  // Bug real confirmado en vivo (jul 2026): "no me deja transferir la cuenta
  // TIENE COMO ERROR" se categorizaba como "limit" porque "deja" se revisaba
  // primero — ignorando que "error"/"falla"/"rechaz"/"bloque" son señales
  // mucho más fuertes y específicas de un problema técnico con ESA cuenta
  // puntual (lo correcto ahí es ofrecer otra cuenta, no preguntar por el
  // límite del banco). "deja"/"permite"/"monto" son ambiguos por sí solos
  // (pueden ser límite O un error genérico), así que ahora se revisan
  // DESPUÉS de las señales técnicas inequívocas.
  if (text.includes("concreta") || text.includes("funciona") || text.includes("error") || text.includes("falla") || text.includes("rechaz") || text.includes("bloque") || text.includes("señal")) return "not_working";
  if (text.includes("límite") || text.includes("limite") || text.includes("monto") || text.includes("mucho") || text.includes("pasa") || text.includes("permite") || text.includes("deja")) return "limit";
  if (text.includes("diario") || text.includes("dia")) return "limit_daily";
  // Bug real confirmado en vivo (jul 2026): "puedo" solo (sin "no" antes)
  // es DEMASIADO genérico — atrapaba preguntas normales como "¿puedo
  // transferir desde varias cuentas para completar el pago?" (una duda
  // legítima sobre pagar dividido desde SUS propias cuentas, nada que ver
  // con un problema técnico) y la mandaba directo a "ofrecerte otra
  // cuenta", ignorando la pregunta real. "no pudo"/"no puedo" (con la
  // negación) sí es una señal real de que algo falló.
  if (text.includes("no pudo") || text.includes("no puedo") || text.includes("no me")) return "not_working";
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
  const clean = nums.map(n => Number(n.replace(/\./g, ""))).filter(n => n > 10);
  if (clean.length === 0) return 0;
  const smallest = Math.min(...clean);
  // Bug real confirmado en vivo (jul 2026): "falabella me deja 700" se
  // interpretaba como 700 CLP literales (un monto sin sentido para
  // cualquier compra real acá, todas en cientos de miles) — en Chile es
  // habitual decir el límite de transferencia abreviado en miles ("me deja
  // 700" = 700.000). Cualquier número bajo 10.000 en este contexto casi
  // seguro está abreviado así.
  return smallest < 10000 ? smallest * 1000 : smallest;
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
// Reconstruye el menú EXACTO que se le mostró al comprador ("1) X 2) Y..."),
// usando los IDs guardados en cs.pendingBankMenuIds — nunca el orden fresco
// de allAccounts, que puede haber cambiado desde que se armó ese menú (ver
// bug real documentado en awaiting_bank_choice). Si falta alguna cuenta del
// pin (ej. se desactivó una), no se confía en el pin — se cae al orden
// normal en vez de mostrar un menú incompleto o con posiciones corridas.
function resolveMenuAccounts(pendingBankMenuIds: any, allAccounts: any[]): any[] | null {
  if (!Array.isArray(pendingBankMenuIds) || pendingBankMenuIds.length === 0) return null;
  const byId = new Map(allAccounts.map((a: any) => [a.id, a]));
  const resolved = pendingBankMenuIds.map((id: any) => byId.get(Number(id))).filter(Boolean);
  return resolved.length === pendingBankMenuIds.length ? resolved : null;
}

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

interface KnownIdentity {
  realName: string;
  orderCount: number;
  lastBank: string | null;
  lastAccountId: number | null;
  lastIsCompany: boolean;
}

async function findKnownRealName(tenantId: number, exchange: string, label: string, maskedNick?: string | null): Promise<KnownIdentity | null> {
  const m = /^(.{1,3})\*+$/.exec((maskedNick || "").trim());
  if (!m) return null;
  const prefix = m[1];
  const candidates = await prisma.p2PBuyerIdentity.findMany({
    where: { tenantId, exchange, label, nickName: { startsWith: prefix } },
    orderBy: { updatedAt: "desc" },
    select: { nickName: true, realName: true, orderCount: true, lastBank: true, lastAccountId: true, lastIsCompany: true },
  });
  const trustworthy = candidates.filter(c => !GENERIC_NICK_PATTERNS.some(re => re.test(c.nickName)));
  const uniqueNames = new Set(trustworthy.map(c => c.realName));
  if (uniqueNames.size !== 1) return null;
  // orderBy updatedAt desc — si hay más de una fila con el mismo nombre real
  // (poco común, ej. dos apodos custom distintos de la misma persona), usa la
  // cuenta/tipo de la más reciente.
  const latest = trustworthy[0];
  return {
    realName: latest.realName,
    orderCount: Math.max(...trustworthy.map(c => c.orderCount)),
    lastBank: latest.lastBank,
    lastAccountId: latest.lastAccountId,
    lastIsCompany: latest.lastIsCompany,
  };
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
    await sendThenTransition(client, exchange, order.orderNumber, cs, msg.join("\n"), "account_sent", { partialAmount: amount, chosenAccountIds: chunks.map((c: any) => c.id), retryCount: 0 });
  } else {
    await sendThenTransition(client, exchange, order.orderNumber, cs,
      "Entendido, con ese monto no podemos dividir el pago. ¿Puedes intentar con otra cuenta?",
      "account_sent", { retryCount: 0 }
    );
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
  const isNew = !cs.isReturning;
  const name = firstNameFrom(cs.realName);
  // Pedido explícito del usuario: un cliente frecuente no debería recibir el
  // mismo mensaje final que alguien que compra por primera vez — reconoce
  // que ya nos conoce en vez de repetirle el mensaje genérico. La
  // calificación solo se pide una vez (primera compra), nunca en compras
  // siguientes — pedirla cada vez a alguien que compra varias veces al día
  // se sentiría repetitivo.
  let msg = isNew
    ? pick([
        "✨ Listo, tus USDT están disponibles. Gracias por tu preferencia, esperamos verte pronto.",
        "✨ Todo listo, tus USDT ya están en tu cuenta. Gracias por confiar en nosotros.",
        "✨ Confirmado, ya tienes tus USDT disponibles. ¡Gracias por la compra!",
      ])
    : pick([
        "✨ Listo, tus USDT ya están disponibles. Gracias por volver a confiar en nosotros.",
        "✨ Todo listo, tus USDT están en tu cuenta. Un gusto tenerte de vuelta.",
        "✨ Confirmado, tus USDT ya están disponibles. Gracias por seguir eligiéndonos.",
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
