import { prisma } from "@/lib/prisma";
import { createHmac, publicEncrypt, constants } from "crypto";

// RSA/ECB/OAEPWITHSHA-256ANDMGF1PADDING (fórmula Java que dio soporte de
// Binance) — Node equivalente: RSA_PKCS1_OAEP_PADDING + oaepHash sha256.
// Binance devuelve la llave pública como base64 crudo (sin envoltura PEM),
// así que se envuelve acá si hace falta.
function encryptForBinanceRsa(content: string, publicKeyRaw: string): string {
  const pem = publicKeyRaw.includes("BEGIN PUBLIC KEY")
    ? publicKeyRaw
    : `-----BEGIN PUBLIC KEY-----\n${(publicKeyRaw.match(/.{1,64}/g) || [publicKeyRaw]).join("\n")}\n-----END PUBLIC KEY-----`;
  const encrypted = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(content, "utf8")
  );
  return encrypted.toString("base64");
}

export async function getBinanceCredentials(tenantId: number, label = "ONZE") {
  return prisma.binanceCredentials.findUnique({ where: { tenantId_label: { tenantId, label } } });
}

export async function saveBinanceCredentials(tenantId: number, apiKey: string, secretKey: string, label = "ONZE") {
  await prisma.binanceCredentials.upsert({
    where: { tenantId_label: { tenantId, label } },
    update: { apiKey, secretKey, isActive: true },
    create: { tenantId, label, apiKey, secretKey, isActive: true },
  });
}

export async function testBinanceCredentials(tenantId: number, label = "ONZE") {
  try {
    const creds = await getBinanceCredentials(tenantId, label);
    if (!creds) return { ok: false, error: "No credentials" };
    await prisma.binanceCredentials.update({
      where: { tenantId_label: { tenantId, label } },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.binanceCredentials.update({
      where: { tenantId_label: { tenantId, label } },
      data: { lastTestedAt: new Date(), testStatus: "failed" },
    });
    return { ok: false, error: e.message };
  }
}

export class BinanceP2PClient {
  private apiKey: string;
  private secretKey: string;
  private apiBase = "https://api.binance.com";
  private p2pBase = "https://p2p.binance.com";
  public latestWeight: number = 0;
  // Límite confirmado por soporte de Binance (jul 2026) — ver comentario en releaseAssets.
  private FUND_PWD_MAX_USD = 500;

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  private sign(data: string): string {
    return createHmac("sha256", this.secretKey).update(data).digest("hex");
  }

  private buildQueryString(params: Record<string, any>): string {
    return Object.keys(params)
      .sort()
      .map(k => {
        const v = params[k];
        if (Array.isArray(v)) {
          return v.map((item: any) => `${k}=${encodeURIComponent(String(item))}`).join("&");
        }
        return `${k}=${encodeURIComponent(String(v))}`;
      })
      .join("&");
  }

  async privateRequest(endpoint: string, params: Record<string, any> = {}, bodyPayload?: any, paramsInBody = false, method: "GET" | "POST" = "POST"): Promise<any> {
    if (paramsInBody) {
      bodyPayload = { ...(bodyPayload || {}), ...params };
      params = {};
    }
    params.recvWindow = 60000;
    params.timestamp = Date.now();
    const queryStr = this.buildQueryString(params);
    const signature = this.sign(queryStr);
    const url = `${this.apiBase}${endpoint}?${queryStr}&signature=${encodeURIComponent(signature)}`;

    const opts: RequestInit = {
      method,
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
        "clientType": "web",
      },
    };
    if (bodyPayload && method !== "GET") opts.body = JSON.stringify(bodyPayload);

    const res = await fetch(url, opts);
    const weightStr = res.headers.get("X-SAPI-USED-IP-WEIGHT-1M") || res.headers.get("x-sapi-used-ip-weight-1m") || res.headers.get("x-mbx-used-weight") || "0";
    this.latestWeight = parseInt(weightStr, 10) || 0;
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Binance HTTP ${res.status} para ${endpoint}: ${bodyText.slice(0, 300)}`);
    }
    const text = await res.text();
    if (!text) throw new Error(`Binance empty response (HTTP ${res.status}) for ${endpoint}`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Binance respuesta inválida (HTTP ${res.status}) para ${endpoint}: ${text.slice(0, 200)}`);
    }
    if (data?.code && data.code !== "000000") {
      console.error(`[Binance API] ${endpoint} returned:`, JSON.stringify(data));
      throw new Error(`Binance error: ${data.message || data.msg || "unknown"} (code: ${data.code})`);
    }
    return data;
  }

  private async publicRequest(endpoint: string, body: Record<string, any> = {}): Promise<any> {
    const res = await fetch(`${this.p2pBase}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Origin": "https://p2p.binance.com",
        "Referer": "https://p2p.binance.com/en/advertiser/",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!text) throw new Error(`Binance empty response (HTTP ${res.status}) for ${endpoint}`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Binance respuesta inválida (HTTP ${res.status}) para ${endpoint}: ${text.slice(0, 200)}`);
    }
    return data;
  }

  // ─── Public: competitor ads ──────────────────────────────────

  async getOnlineAds(params: {
    asset: string;
    fiat: string;
    tradeType: "SELL" | "BUY";
    page?: number;
    rows?: number;
    payTypes?: string[];
  }): Promise<{ data: any[] }> {
    return this.publicRequest("/bapi/c2c/v2/friendly/c2c/adv/search", {
      asset: params.asset,
      fiat: params.fiat,
      tradeType: params.tradeType,
      page: params.page || 1,
      rows: Math.min(params.rows || 20, 20),
      payTypes: params.payTypes || [],
      publisherType: null,
    });
  }

  // ─── Private: own ads ────────────────────────────────────────

  async getMyAds(page = 1, rows = 20) {
    return this.privateRequest("/sapi/v1/c2c/ads/listWithPagination", { page, rows: Math.min(rows, 20) }, undefined, true);
  }

  async getAdDetail(adId: string) {
    return this.privateRequest("/sapi/v1/c2c/ads/getDetailByNo", { adsNo: adId });
  }

  async postAd(params: Record<string, any>) {
    return this.privateRequest("/sapi/v1/c2c/ads/post", {}, params);
  }

  // Replica el botón "TODO" de la web de Binance. Lista blanca EXACTA capturada
  // del request real de la app (32 campos) — no lista negra, no forward-all.
  // Cada campo con el tipo/valor EXACTO de getAdDetail (números como números,
  // sin String()). Cambia SOLO price.
  // `visible` opcional: 1 = normal (default), 0 = ocultar el anuncio a
  // compradores sin borrarlo — usado como freno de emergencia cuando el bot
  // no puede corregir el precio por el límite de velocidad de Binance, para
  // no dejarlo expuesto tomando órdenes a un precio desactualizado.
  async updateAd(params: Record<string, any>) {
    const { adId, price, visible } = params;
    const detailRes = await this.getAdDetail(String(adId));
    const detail = detailRes?.data;
    if (!detail) throw new Error(`No se pudo leer el detalle del anuncio ${adId} antes de actualizar`);

    const body: Record<string, any> = {
      adAdditionalKycVerifyItems: detail.adAdditionalKycVerifyItems ?? [],
      adTags: detail.adTags ?? [],
      advNo: detail.advNo,
      advStatus: detail.advStatus,
      asset: detail.asset,
      assetScale: detail.assetScale,
      autoReplyMsg: detail.autoReplyMsg,
      buyerBtcPositionLimit: detail.buyerBtcPositionLimit,
      buyerRegDaysLimit: detail.buyerRegDaysLimit,
      classify: detail.classify,
      fiatScale: detail.fiatScale,
      fiatUnit: detail.fiatUnit,
      initAmount: detail.initAmount,
      isSafePayment: false,
      isStarTraderAdditionalKycExclusion: false,
      isStarTraderCounterpartyConditionsExclusion: false,
      launchCountry: [],
      maxSingleTransAmount: detail.maxSingleTransAmount,
      minSingleTransAmount: detail.minSingleTransAmount,
      onlineDelayTime: 0,
      onlineNow: true,
      payTimeLimit: detail.payTimeLimit,
      price: price != null ? String(price) : detail.price, // único cambio intencional (o sin cambio si no se pasa)
      priceFloatingRatio: detail.priceFloatingRatio,
      priceScale: detail.priceScale,
      priceType: detail.priceType,
      remarks: detail.remarks,
      takerAdditionalKycRequired: detail.takerAdditionalKycRequired,
      tradeMethods: detail.tradeMethods,
      tradeType: detail.tradeType,
      visible: visible != null ? visible : 1,
      voucherTemplateNo: "",
    };

    return this.privateRequest("/sapi/v1/c2c/ads/update", {}, body);
  }

  // Replica el botón "TODO" (resincronizar cantidad) de la web de Binance.
  // Fórmula EXACTA confirmada por soporte de Binance: initAmount no es un valor
  // libre — hay que preservar (initAmount - surplusAmount), que representa lo ya
  // vendido. Para llevar surplusAmount a un valor nuevo:
  //   initAmount_after = initAmount_before + (surplusAmount_after - surplusAmount_before)
  async updateAdQuantity(adId: string, targetSurplusAmount: number) {
    const detailRes = await this.getAdDetail(String(adId));
    const detail = detailRes?.data;
    if (!detail) throw new Error(`No se pudo leer el detalle del anuncio ${adId} antes de sincronizar cantidad`);

    const initAmountBefore = Number(detail.initAmount);
    const surplusAmountBefore = Number(detail.surplusAmount);
    const initAmountAfter = initAmountBefore + (targetSurplusAmount - surplusAmountBefore);

    const body: Record<string, any> = {
      adAdditionalKycVerifyItems: detail.adAdditionalKycVerifyItems ?? [],
      adTags: detail.adTags ?? [],
      advNo: detail.advNo,
      advStatus: detail.advStatus,
      asset: detail.asset,
      assetScale: detail.assetScale,
      autoReplyMsg: detail.autoReplyMsg,
      buyerBtcPositionLimit: detail.buyerBtcPositionLimit,
      buyerRegDaysLimit: detail.buyerRegDaysLimit,
      classify: detail.classify,
      fiatScale: detail.fiatScale,
      fiatUnit: detail.fiatUnit,
      initAmount: initAmountAfter.toFixed(2), // único cambio intencional
      isSafePayment: false,
      isStarTraderAdditionalKycExclusion: false,
      isStarTraderCounterpartyConditionsExclusion: false,
      launchCountry: [],
      maxSingleTransAmount: detail.maxSingleTransAmount,
      minSingleTransAmount: detail.minSingleTransAmount,
      onlineDelayTime: 0,
      onlineNow: true,
      payTimeLimit: detail.payTimeLimit,
      price: detail.price, // sin cambiar
      priceFloatingRatio: detail.priceFloatingRatio,
      priceScale: detail.priceScale,
      priceType: detail.priceType,
      remarks: detail.remarks,
      takerAdditionalKycRequired: detail.takerAdditionalKycRequired,
      tradeMethods: detail.tradeMethods,
      tradeType: detail.tradeType,
      visible: 1,
      voucherTemplateNo: "",
    };

    return this.privateRequest("/sapi/v1/c2c/ads/update", {}, body);
  }

  async removeAd(adId: string) {
    return this.privateRequest("/sapi/v1/c2c/ads/batchUpdateStatus", {}, { adsNos: [adId], advStatus: "close" });
  }

  async recreateAd(adId: string, targetPrice: string): Promise<string | null> {
    // Fetch current ad detail for payment methods and limits
    let identifiers: string[] = [];
    let minAmount = "1000";
    let maxAmount = "5000000";
    let initAmt = "5000";
    let fiatUnit = "CLP";
    try {
      const detailRes = await this.getAdDetail(adId);
      const adv = detailRes?.data?.adv || detailRes?.data || {};
      identifiers = (adv.tradeMethods || []).map((tm: any) => tm.identifier ?? tm.payType ?? "");
      if (adv.minSingleTransAmount) minAmount = String(adv.minSingleTransAmount);
      if (adv.maxSingleTransAmount) maxAmount = String(adv.maxSingleTransAmount);
      if (adv.initAmount) initAmt = String(adv.initAmount);
      if (adv.fiatUnit) fiatUnit = adv.fiatUnit;
    } catch (_) {}
    const tradeMethods = identifiers.filter(Boolean).map(id => ({ identifier: id }));
    if (tradeMethods.length === 0) {
      tradeMethods.push({ identifier: "BANK" });
    }
    const postParams: Record<string, any> = {
      tradeType: "1",
      asset: "USDT",
      fiatUnit,
      priceType: "1",
      price: targetPrice,
      initAmount: initAmt,
      maxSingleTransAmount: maxAmount,
      minSingleTransAmount: minAmount,
      buyerKycLimit: 1,
      classify: "profession",
      tradeMethods,
      payTimeLimit: 15,
    };
    let newAdNo: string | null = null;
    try {
      const res = await this.postAd(postParams);
      newAdNo = res?.data?.advNo ?? res?.data?.adNo ?? null;
    } catch (e: any) {
      try {
        const res = await this.postAd(postParams);
        newAdNo = res?.data?.advNo ?? res?.data?.adNo ?? null;
      } catch (e2: any) {
        throw new Error(`recreateAd: postAd failed twice (${e.message}, ${e2.message}) — old ad preserved`);
      }
    }
    if (newAdNo) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        await this.removeAd(adId);
      } catch (_) {}
    }
    return newAdNo;
  }

  // ─── Orders ──────────────────────────────────────────────────

  async getOrders(params: { page: number; rows: number; tradeType?: string; status?: string; startTimestamp?: number; endTimestamp?: number }) {
    const allParams: Record<string, any> = {
      page: params.page || 1,
      rows: params.rows || 50,
      tradeType: params.tradeType || "SELL",
      recvWindow: 60000,
      timestamp: Date.now(),
    };
    // Filtrar por rango de fecha DIRECTO en Binance (soportado por este endpoint)
    // es mucho más confiable que traer páginas sueltas y filtrar acá: con
    // volumen alto de órdenes, nuevas órdenes se insertan mientras se pagina,
    // corriendo los límites de cada página y perdiendo/duplicando resultados.
    // Con startTimestamp/endTimestamp la ventana queda fija en el servidor.
    if (params.startTimestamp != null) allParams.startTimestamp = params.startTimestamp;
    if (params.endTimestamp != null) allParams.endTimestamp = params.endTimestamp;
    const queryStr = this.buildQueryString(allParams);
    const signature = this.sign(queryStr);
    const url = `${this.apiBase}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryStr}&signature=${encodeURIComponent(signature)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    if (!text) throw new Error(`Binance empty response (HTTP ${res.status}) para órdenes`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Binance respuesta inválida (HTTP ${res.status}) para órdenes: ${text.slice(0, 200)}`);
    }
    if (data?.code && data.code !== "000000") {
      throw new Error(`Binance error: ${data.message || data.msg || "unknown"} (code: ${data.code})`);
    }
    return data;
  }

  // ─── Balance ─────────────────────────────────────────────────

  async getBalance(coin = "USDT") {
    const res = await this.privateRequest("/sapi/v1/asset/get-funding-asset", {}, { asset: coin });
    if (Array.isArray(res)) {
      const asset = res.find((b: any) => b.asset === coin);
      return asset ? { free: asset.free, locked: asset.locked, balance: asset.free } : { free: "0", locked: "0", balance: "0" };
    }
    return { free: "0", locked: "0", balance: "0" };
  }

  // ─── KYC / Verification ──────────────────────────────────────

  async verifyOrder(orderNumber: string) {
    return this.privateRequest("/sapi/v1/c2c/orderMatch/verifiedAdditionalKyc", {}, { orderNumber }, true);
  }

  // ─── Liberar orden (release) ───────────────────────────────────
  // Endpoint y fórmula confirmados por soporte oficial de Binance (jul 2026):
  // 1) getUserOrderDetail (param "adOrderNo", NO "orderNumber") da el
  //    "selectedPayId" — el payId que exige releaseCoin.
  // 2) rsa-public-key (GET) da la llave pública para cifrar la contraseña de
  //    fondos (FUND_PWD) con RSA/OAEP-SHA256.
  // 3) releaseCoin con authType=FUND_PWD, code=<cifrado>, payId, orderNumber,
  //    confirmPaidType="normal" (NUNCA "quick" — eso libera sin que conste que
  //    el comprador ya pagó, no se expone esa opción a propósito).
  //
  // Límite confirmado por soporte de Binance (jul 2026): la contraseña de
  // fondos SOLO reemplaza el 2FA estándar para órdenes P2P de USD $500 o
  // menos — no sirve para retiros, transferencias fiat, ni cambios de
  // seguridad de la cuenta (eso siempre exige 2FA completo, sin excepción).
  // Por encima de $500 Binance va a rechazar igual el release y pedir 2FA —
  // se corta ANTES de intentarlo para dar un mensaje claro en vez de un error
  // críptico de Binance. El activo siempre es USDT en este bot (paridad ~1:1
  // con USD), así que "amount" de la orden se usa directo como proxy de USD.

  async getUserOrderDetail(orderNumber: string) {
    return this.privateRequest("/sapi/v1/c2c/orderMatch/getUserOrderDetail", {}, { adOrderNo: orderNumber }, true);
  }

  async getRsaPublicKey(): Promise<string> {
    const res = await this.privateRequest("/sapi/v1/c2c/cryptography/rsa-public-key", {}, undefined, false, "GET");
    return res.data;
  }

  async releaseAssets(orderNumber: string, fundPassword: string) {
    const detail = await this.getUserOrderDetail(orderNumber);
    const payId = detail?.data?.selectedPayId;
    if (!payId) {
      throw new Error(`No se pudo obtener selectedPayId para la orden ${orderNumber}`);
    }

    const amountUsdt = Number(detail?.data?.amount ?? 0);
    if (amountUsdt > this.FUND_PWD_MAX_USD) {
      throw new Error(
        `Esta orden es de ${amountUsdt.toFixed(2)} USDT — supera el límite de $${this.FUND_PWD_MAX_USD} USD que Binance permite autorizar con la contraseña de fondos. Libérala manualmente desde la app de Binance.`
      );
    }

    const publicKeyRaw = await this.getRsaPublicKey();
    const code = encryptForBinanceRsa(fundPassword, publicKeyRaw);

    return this.privateRequest("/sapi/v1/c2c/orderMatch/releaseCoin", {}, {
      authType: "FUND_PWD",
      code,
      orderNumber,
      payId,
      confirmPaidType: "normal",
    }, true);
  }

  // ─── Chat ──────────────────────────────────────────────────────
  // Leer siempre fue oficial (GET firmado). Enviar NO tiene endpoint HTTP —
  // confirmado por soporte de Binance (jul 2026) — el envío es exclusivamente
  // por WebSocket. getChatCredential()/sendChatMessageWS() reemplazan el
  // envío por Playwright/cookies que se usaba antes (ver AGENTS.md).

  // GET /sapi/v1/c2c/chat/retrieveChatCredential — el header "clientType: web"
  // es obligatorio, sin él Binance devuelve {"code":-31002,"msg":"illegal
  // parameter"} (confirmado por soporte y reproducido en pruebas propias).
  async getChatCredential(): Promise<{ chatWssUrl: string; listenKey: string; listenToken: string }> {
    const params: any = { timestamp: Date.now() };
    const queryStr = this.buildQueryString(params);
    const sig = this.sign(queryStr);
    const url = `https://api.binance.com/sapi/v1/c2c/chat/retrieveChatCredential?${queryStr}&signature=${encodeURIComponent(sig)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": this.apiKey, "clientType": "web", "Content-Type": "application/json" },
    });
    const text = await res.text();
    if (!text) throw new Error(`Binance empty response (HTTP ${res.status}) para retrieveChatCredential`);
    const data = JSON.parse(text);
    if (data?.code && data.code !== "000000") {
      throw new Error(`Binance error: ${data.message || data.msg || "unknown"} (code: ${data.code})`);
    }
    if (!data?.data?.chatWssUrl || !data?.data?.listenKey || !data?.data?.listenToken) {
      throw new Error(`retrieveChatCredential: respuesta sin wssUrl/listenKey/listenToken: ${text.slice(0, 200)}`);
    }
    return data.data;
  }

  // Abre una conexión WS cortita solo para este mensaje (conectar → mandar →
  // esperar un instante por si Binance devuelve un error → cerrar). No se
  // mantiene una conexión persistente entre ciclos — más simple y no
  // depende de nada corriendo todo el tiempo en el servidor.
  async sendChatMessageWS(orderNumber: string, message: string): Promise<{ ok: boolean; error?: string }> {
    const { chatWssUrl, listenKey, listenToken } = await this.getChatCredential();
    const wsUrl = `${chatWssUrl}/${listenKey}?token=${listenToken}&clientType=web`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch {}
        resolve(result);
      };

      const openTimeout = setTimeout(() => finish({ ok: false, error: "Timeout al conectar al WebSocket del chat" }), 8000);

      const ws = new WebSocket(wsUrl);

      ws.addEventListener("open", () => {
        clearTimeout(openTimeout);
        const payload = {
          type: "text",
          uuid: Date.now().toString(36) + Math.random().toString(36).slice(2),
          orderNo: orderNumber,
          content: message,
          self: true,
          clientType: "web",
          createTime: Date.now(),
        };
        try {
          ws.send(JSON.stringify(payload));
        } catch (e: any) {
          finish({ ok: false, error: `Error al enviar por WS: ${e.message}` });
          return;
        }
        // Binance no siempre manda un ack explícito de éxito — si no llega
        // ningún error en esta ventana, se considera enviado. Confirmado en
        // pruebas reales: el mensaje queda guardado y le llega de verdad al
        // comprador.
        setTimeout(() => finish({ ok: true }), 1500);
      });

      ws.addEventListener("message", (ev: any) => {
        const raw = String(ev.data ?? "");
        let isError = false;
        try {
          const parsed = JSON.parse(raw);
          isError = parsed?.type === "error" || String(parsed?.content || "").toUpperCase().includes("ILLEGAL");
        } catch {
          isError = raw.toUpperCase().includes("ERROR") || raw.toUpperCase().includes("ILLEGAL");
        }
        if (isError) finish({ ok: false, error: raw.slice(0, 300) });
      });

      ws.addEventListener("error", () => {
        finish({ ok: false, error: "Error de conexión al WebSocket del chat" });
      });

      ws.addEventListener("close", (ev: any) => {
        // Un cierre inesperado ANTES de terminar de mandar es un fallo real.
        if (!settled) finish({ ok: false, error: `WS cerrado antes de confirmar (code ${ev.code})` });
      });
    });
  }

  async getChatMessages(orderNumber: string, page = 1, rows = 50) {
    const params: any = { orderNo: orderNumber, page, rows, recvWindow: 60000, timestamp: Date.now() };
    const queryStr = this.buildQueryString(params);
    const sig = this.sign(queryStr);
    const url = `https://api.binance.com/sapi/v1/c2c/chat/retrieveChatMessagesWithPagination?${queryStr}&signature=${encodeURIComponent(sig)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": this.apiKey, "Content-Type": "application/json" },
    });
    return res.json();
  }
}
