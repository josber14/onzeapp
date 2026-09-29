import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";
import { bybitApiBase, bybitFetch } from "./bybit-proxy";

export async function getBybitCredentials(tenantId: number, label = "ONZE") {
  return prisma.bybitCredentials.findFirst({
    where: { tenantId, isActive: true, label },
    orderBy: { id: "asc" },
  });
}

export async function saveBybitCredentials(
  tenantId: number,
  apiKey: string,
  secretKey: string,
  label = "ONZE"
) {
  const existing = await prisma.bybitCredentials.findFirst({
    where: { tenantId, label },
  });
  if (existing) {
    await prisma.bybitCredentials.update({
      where: { id: existing.id },
      data: { apiKey, secretKey, isActive: true },
    });
  } else {
    await prisma.bybitCredentials.create({
      data: { tenantId, label, apiKey, secretKey, isActive: true },
    });
  }
}

export async function testBybitCredentials(tenantId: number, label = "ONZE") {
  try {
    const creds = await getBybitCredentials(tenantId, label);
    if (!creds) return { ok: false, error: "No credentials" };
    const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
    await client.getAccountInfo();
    await prisma.bybitCredentials.update({
      where: { id: creds.id },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    const creds = await getBybitCredentials(tenantId, label);
    if (creds) {
      await prisma.bybitCredentials.update({
        where: { id: creds.id },
        data: { lastTestedAt: new Date(), testStatus: "failed" },
      });
    }
    return { ok: false, error: e.message };
  }
}

export type BybitAdStatus = 10 | 20; // 10=online, 20=offline

export interface BybitAdPostParams {
  tokenId: string;
  currencyId: string;
  side: "0" | "1"; // 0=buy, 1=sell
  price: string;
  quantity: string;
  minAmount: string;
  maxAmount: string;
  payments?: string[];
  paymentIds?: string[];
  paymentPeriod: number;
  remark?: string;
  priceType?: string;
  premium?: string;
  itemType?: string;
  tradingPreferenceSet?: any;
  [key: string]: any;
}

export interface BybitAdUpdateParams {
  id: string;
  price?: string;
  quantity?: string;
  minAmount?: string;
  maxAmount?: string;
  payments?: string[];
  paymentIds?: string[];
  paymentPeriod?: number;
  status?: BybitAdStatus;
  remark?: string;
  actionType?: "MODIFY" | "ACTIVE";
  priceType?: string;
  premium?: string;
  tradingPreferenceSet?: any;
  [key: string]: any;
}

// Bybit bloquea (vía CloudFront) las peticiones que llegan desde la región de
// EE.UU. donde corren las funciones de Vercel -- el bloqueo es geográfico y
// permanente, no un error transitorio, así que reintentar en cada llamada
// (cada ~60s desde el panel de Socio) solo desperdicia una llamada de red
// completa que sabemos que va a fallar. Este caché a nivel de módulo (se
// mantiene mientras la instancia serverless siga "tibia") evita ese
// desperdicio: tras el primer bloqueo confirmado, las siguientes llamadas
// fallan de inmediato sin tocar la red durante `CLOUDFRONT_BLOCK_BACKOFF_MS`.
const CLOUDFRONT_BLOCK_BACKOFF_MS = 5 * 60 * 1000;
let cloudfrontBlockedUntil = 0;

export class BybitP2PClient {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;
  private recvWindow = "5000";

  constructor(apiKey: string, secretKey: string, testnet?: boolean) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = testnet ? "https://api-testnet.bybit.com" : bybitApiBase();
  }

  private sign(timestamp: string, payload: string): string {
    const str = timestamp + this.apiKey + this.recvWindow + payload;
    return createHmac("sha256", this.secretKey).update(str).digest("hex");
  }

  private async request(endpoint: string, body: Record<string, any> = {}, method = "POST"): Promise<any> {
    if (Date.now() < cloudfrontBlockedUntil) {
      const remainingSec = Math.ceil((cloudfrontBlockedUntil - Date.now()) / 1000);
      throw new Error(
        `Bybit bloqueado por CloudFront (país de origen del servidor) -- en espera ${remainingSec}s antes de reintentar`
      );
    }

    const timestamp = Date.now().toString();
    const isGet = method === "GET";
    const sortedKeys = isGet ? Object.keys(body).sort() : [];
    const queryStr = isGet && sortedKeys.length ? "?" + sortedKeys.map(k => `${k}=${encodeURIComponent(body[k])}`).join("&") : "";
    const payload = isGet ? queryStr.slice(1) : JSON.stringify(body);
    const signature = this.sign(timestamp, payload);

    const res = await bybitFetch(this.baseUrl + endpoint + queryStr, {
      method,
      headers: {
        "X-BAPI-API-KEY": this.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-SIGN": signature,
        "X-BAPI-RECV-WINDOW": this.recvWindow,
        "Content-Type": "application/json",
      },
      ...(isGet ? {} : { body: payload }),
    });

    const text = await res.text();
    if (!text) {
      throw new Error(`Bybit empty response (HTTP ${res.status}) for ${endpoint}`);
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      if (text.includes("CloudFront") && text.includes("block access from your country")) {
        cloudfrontBlockedUntil = Date.now() + CLOUDFRONT_BLOCK_BACKOFF_MS;
      }
      throw new Error(`Bybit respuesta inválida (HTTP ${res.status}) para ${endpoint}: ${text.slice(0, 200)}`);
    }
    const retCode = data.retCode ?? data.ret_code;
    const retMsg = data.retMsg ?? data.ret_msg;
    if (retCode !== 0 && retCode !== undefined) {
      throw new Error(`Bybit error ${retCode}: ${retMsg}`);
    }
    return data;
  }

  // ─── Ads ──────────────────────────────────────────────────────

  async getMyAds(page = 1, size = 50) {
    return this.request("/v5/p2p/item/personal/list", {});
  }

  async getAdDetail(itemId: string) {
    return this.request("/v5/p2p/item/info", { itemId });
  }

  async postAd(params: BybitAdPostParams) {
    return this.request("/v5/p2p/item/create", params);
  }

  async updateAd(params: BybitAdUpdateParams) {
    return this.request("/v5/p2p/item/update", params);
  }

  async removeAd(id: string) {
    return this.request("/v5/p2p/item/cancel", { itemId: id });
  }

  // Reactivar un anuncio que BYBIT MISMO puso offline (ej. error 912120031
  // durante el ciclo normal, típicamente por saldo insuficiente momentáneo).
  // Confirmado contra la documentación oficial de Bybit (item/update): ese
  // endpoint NO tiene ningún parámetro "status" -- solo actionType, con
  // exactamente 2 valores: "MODIFY" (cambiar precio/cantidad de un anuncio
  // YA online) o "ACTIVE" (reactivar uno que Bybit puso offline). Mandar
  // {id, status} devolvía ret_code 0 ("éxito") pero Bybit lo ignoraba en
  // silencio -- confirmado en vivo, probando apagar y prender un anuncio
  // real: el status nunca cambiaba pese a la respuesta "exitosa". Por eso
  // NO sirve para apagar un anuncio a propósito (no existe un actionType
  // para eso) -- solo para el caso contrario, reactivar uno que ya está
  // offline por una razón ajena a nosotros.
  async reactivateOfflineAd(id: string) {
    const detailRes = await this.getAdDetail(id);
    const ad = detailRes?.result;
    if (!ad) throw new Error(`No se pudo leer el detalle del anuncio ${id} antes de reactivarlo`);

    const payObjs = ad.paymentTerms ?? ad.payments ?? [];
    const paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];
    const tps = ad.tradingPreferenceSet ?? {};
    const strTps: any = {};
    for (const k of Object.keys(tps)) strTps[k] = String(tps[k] ?? "");

    return this.updateAd({
      id,
      price: String(ad.price ?? "0"),
      actionType: "ACTIVE",
      priceType: String(ad.priceType ?? "0"),
      premium: String(ad.premium ?? "0"),
      quantity: String(ad.lastQuantity ?? ad.quantity ?? "0"),
      minAmount: String(ad.minAmount ?? "0"),
      maxAmount: String(ad.maxAmount ?? "0"),
      paymentPeriod: String(ad.paymentPeriod ?? "15") as any,
      paymentIds,
      remark: String(ad.remark ?? ""),
      tradingPreferenceSet: strTps,
    });
  }

  // Botón "Apagar/Prender anuncio" del panel (sep 2026, pedido explícito
  // del usuario -- quiere poder apagar el anuncio de Bybit desde el panel
  // sin tener que entrar a la app del teléfono). Bybit NO tiene una acción
  // de "pausa" real (ver comentario de reactivateOfflineAd) -- la única
  // forma real de que el anuncio deje de estar visible es CANCELARLO de
  // verdad (removeAd). "Prender" de nuevo entonces no es "reactivar" sino
  // CREAR un anuncio nuevo con los mismos datos del que se canceló -- igual
  // que la recreación automática del bot, puede fallar mientras la cuenta
  // siga restringida como "Trial Advertiser" (ver AGENTS.md). Devuelve el
  // nuevo adId para que quien llama actualice su propia fila en la base.
  async recreateFromCancelled(id: string): Promise<string> {
    const detailRes = await this.getAdDetail(id);
    const ad = detailRes?.result;
    if (!ad) throw new Error(`No se pudo leer el detalle del anuncio ${id} para volver a publicarlo`);

    const payObjs = ad.paymentTerms ?? ad.payments ?? [];
    const paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];
    const tps = ad.tradingPreferenceSet ?? {};
    const strTps: any = {};
    for (const k of Object.keys(tps)) strTps[k] = String(tps[k] ?? "");

    const res = await this.postAd({
      tokenId: ad.tokenId || "USDT",
      currencyId: ad.currencyId || "CLP",
      side: String(ad.side === 0 ? 0 : 1) as "0" | "1",
      price: String(ad.price ?? "0"),
      priceType: String(ad.priceType ?? "0"),
      premium: String(ad.premium ?? "0"),
      quantity: String(ad.lastQuantity ?? ad.quantity ?? "0"),
      minAmount: String(ad.minAmount ?? "0"),
      maxAmount: String(ad.maxAmount ?? "0"),
      paymentPeriod: String(ad.paymentPeriod ?? "15") as any,
      paymentIds,
      remark: String(ad.remark ?? ""),
      tradingPreferenceSet: strTps,
      itemType: String(ad.itemType ?? "ORIGIN"),
      status: 10,
    } as any);

    const newAdId = res?.result?.itemId ?? res?.result?.item?.id ?? res?.result?.id;
    if (!newAdId) throw new Error(`Bybit no devolvió el id del anuncio nuevo (respuesta: ${JSON.stringify(res).slice(0, 300)})`);
    return String(newAdId);
  }

  // ─── Orders ───────────────────────────────────────────────────

  async getOrders(params: {
    page: number;
    size: number;
    status?: number;
    tokenId?: string;
    side?: number;
    beginTime?: string;
    endTime?: string;
  }) {
    return this.request("/v5/p2p/order/simplifyList", params);
  }

  async getPendingOrders(page = 1, size = 10) {
    return this.request("/v5/p2p/order/pending/simplifyList", { page, size });
  }

  async getOrderDetail(orderId: string) {
    return this.request("/v5/p2p/order/info", { orderId });
  }

  async markAsPaid(orderId: string, paymentType: string, paymentId: string) {
    return this.request("/v5/p2p/order/pay", { orderId, paymentType, paymentId });
  }

  async releaseAssets(orderId: string) {
    return this.request("/v5/p2p/order/finish", { orderId });
  }

  // ─── Chat ─────────────────────────────────────────────────────
  // ACTUALIZACIÓN (sep 2026): Bybit CERRÓ los endpoints de chat de arriba
  // (/v5/p2p/order/message/send, /v5/p2p/order/message/listpage) --
  // devuelven "912200387: chat open api close, pls chat with new open
  // api". Confirmado en vivo, a mano, contra la cuenta real (sin arriesgar
  // mandar nada real a un comprador -- cada endpoint se probó con campos
  // obligatorios faltantes a propósito hasta confirmar el error exacto de
  // "falta tal campo", nunca completando un envío real):
  //
  //   - /v5/p2p/chat/session/list_v1 (lastId, size, readStatus): lista
  //     las conversaciones -- una por CONTRAPARTE (comprador/vendedor), no
  //     por orden. Cada una trae sessionName (su nickname), sessionId
  //     (cifrado, opaco) y unreadCount.
  //   - /v5/p2p/chat/message/listpage_v1 (sessionId, limit -- OJO, no
  //     "size"/"lastId" como sugiere la librería oficial de Python de
  //     Bybit, confirmado a mano que esos nombres devuelven vacío):
  //     mensajes de una sesión. El campo `message` de cada item viene como
  //     un STRING con JSON adentro: {"content":"...","msgType":301,
  //     "fileName":"",...} -- no como texto plano directo (formato viejo).
  //   - /v5/p2p/chat/message/send_v1: requiere los 4 juntos -- orderId,
  //     sessionId, contentType, message (confirmado probando con cada uno
  //     faltante por turno, cada vez devolvía el error "X is null" del
  //     campo que faltaba, sin llegar nunca a completar un envío real).
  //
  // Como la sesión no trae el orderId directo, se resuelve por nickname de
  // la contraparte (sessionName === targetNickName de la orden, vía
  // getOrderDetail). getChatMessages/sendChatMessage mantienen la MISMA
  // firma y la MISMA forma de respuesta que antes (adaptando el formato
  // nuevo al viejo) para no tener que tocar chat-agent.ts, que ya sabe leer
  // esa forma.
  //
  // Limitación conocida: el formato nuevo no documenta cómo distinguir un
  // mensaje de "sistema" (ej. el viejo msgType:0) de uno de texto normal --
  // por ahora todo se trata como texto (igual que ya hacía el código viejo
  // para cualquier msgType distinto de 0), hasta confirmar en vivo si
  // Bybit sigue mandando algún evento de sistema por este canal nuevo.

  private ownNickname: string | null = null;
  private async getOwnNickname(): Promise<string> {
    if (this.ownNickname) return this.ownNickname;
    const info = await this.getAccountInfo();
    this.ownNickname = String(info?.result?.nickName || "");
    return this.ownNickname;
  }

  private chatSessionCache = new Map<string, { sessionId: string; expiresAt: number }>();
  private async resolveChatSessionId(orderId: string): Promise<string | null> {
    const cached = this.chatSessionCache.get(orderId);
    if (cached && Date.now() < cached.expiresAt) return cached.sessionId;

    const detail = await this.getOrderDetail(orderId);
    const counterpartyName = detail?.result?.targetNickName;
    if (!counterpartyName) return null;

    // size máximo confirmado en vivo: 50 devuelve "913100009: page size
    // error" -- 20 es el mismo tope que ya usan otros endpoints paginados
    // de Bybit (ver getOnlineAds).
    const sessions = await this.request("/v5/p2p/chat/session/list_v1", { lastId: 0, size: 20, readStatus: 2 });
    const list = sessions?.result?.chatSession ?? [];
    const match = list.find((s: any) => s.sessionName === counterpartyName);
    if (!match) return null;

    this.chatSessionCache.set(orderId, { sessionId: match.sessionId, expiresAt: Date.now() + 5 * 60 * 1000 });
    return match.sessionId;
  }

  async sendChatMessage(orderId: string, message: string) {
    const sessionId = await this.resolveChatSessionId(orderId);
    if (!sessionId) {
      throw new Error(`No se encontró la sesión de chat de Bybit para la orden ${orderId} (contraparte no aparece en la lista de sesiones)`);
    }
    return this.request("/v5/p2p/chat/message/send_v1", { orderId, sessionId, contentType: "str", message });
  }

  async getChatMessages(orderId: string, page = 1, size = 20) {
    const sessionId = await this.resolveChatSessionId(orderId);
    if (!sessionId) return { ret_code: 0, ret_msg: "SUCCESS", result: { result: [] } };

    const res = await this.request("/v5/p2p/chat/message/listpage_v1", { sessionId, limit: size });
    const raw = res?.result?.messages ?? [];
    const ownNickname = await this.getOwnNickname();
    const ownUserId = await this.getOwnUserId();

    const mapped = raw.map((m: any) => {
      let inner: any = {};
      try { inner = JSON.parse(m.message ?? "{}"); } catch { inner = { content: String(m.message ?? "") }; }
      const senderNick = String(m.sendUserNickName ?? "");
      const isSelf = senderNick === ownNickname;
      // Confirmado en vivo (sep 2026): los mensajes de sistema del nuevo
      // chat vienen con sendUserNickName "SYSTEM" (ej. "The buyer has
      // successfully completed the payment...", "You've successfully
      // released USDT to the buyer.") -- sin esto se tratarían como si el
      // COMPRADOR los hubiera escrito, y el bot intentaría "responderle" a
      // un aviso automático de Bybit. msgType:0 es lo que chat-agent.ts ya
      // interpreta como "system" (ver fetchMessages) y descarta.
      const isSystem = senderNick === "SYSTEM";
      return {
        id: String(m.id ?? ""),
        msgType: isSystem ? 0 : 1,
        contentType: inner.fileName ? "pic" : "str",
        message: inner.fileName || inner.content || "",
        userId: isSelf ? ownUserId : `other:${senderNick}`,
        createDate: m.createDate,
      };
    });

    return { ret_code: 0, ret_msg: "SUCCESS", result: { result: mapped } };
  }

  // Necesario para distinguir "mensaje nuestro" vs "mensaje del comprador" en
  // getChatMessages -- a diferencia de Binance, Bybit NO manda un campo
  // `self` en cada mensaje; solo trae el `userId` de quien lo escribió. Hay
  // que compararlo contra nuestro propio userId (ver /v5/p2p/user/personal/info).
  // Cacheado en la instancia porque no cambia y engine.ts crea un cliente
  // nuevo por ciclo -- evita una llamada extra por cada orden del mismo ciclo.
  private ownUserId: string | null = null;
  async getOwnUserId(): Promise<string> {
    if (this.ownUserId) return this.ownUserId;
    const info = await this.getAccountInfo();
    this.ownUserId = String(info?.result?.userId || "");
    return this.ownUserId;
  }

  // ─── Balance & Account ────────────────────────────────────────

  async getBalance(coin = "USDT") {
    return this.request("/v5/asset/transfer/query-account-coins-balance", { accountType: "FUND", coin }, "GET");
  }

  async getAccountInfo() {
    return this.request("/v5/p2p/user/personal/info", {});
  }

  async getPaymentMethods() {
    return this.request("/v5/p2p/user/payment/list", {});
  }

  // ─── Online Ads (competitors) ────────────────────────────────

  async getOnlineAds(params: {
    tokenId: string;
    currencyId: string;
    side: "0" | "1";
    page?: string;
    size?: string;
  }) {
    return this.request("/v5/p2p/item/online", params);
  }
}

export function bybitOrderStatusLabel(status: number): string {
  switch (status) {
    case 5: return "waiting_chain";
    case 10: return "pending";
    case 20: return "pending";
    case 30: return "appealing";
    case 40: return "cancelled";
    case 50: return "completed";
    case 60: return "paying";
    case 70: return "pay_fail";
    case 80: return "cancelled";
    case 90: return "pending";
    case 100: return "appealing";
    case 110: return "pending";
    default: return "unknown";
  }
}

export function bybitOrderGroup(status: number): "pending" | "completed" | "cancelled" {
  const label = bybitOrderStatusLabel(status);
  if (label === "completed") return "completed";
  if (["cancelled", "pay_fail"].includes(label)) return "cancelled";
  return "pending";
}
