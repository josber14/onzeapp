import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";

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

  async privateRequest(endpoint: string, params: Record<string, any> = {}, bodyPayload?: any, paramsInBody = false): Promise<any> {
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
      method: "POST",
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
        "clientType": "web",
      },
    };
    if (bodyPayload) opts.body = JSON.stringify(bodyPayload);

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
  async updateAd(params: Record<string, any>) {
    const { adId, price } = params;
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
      price: String(price), // único cambio intencional
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

  // ─── Chat ──────────────────────────────────────────────────────

  async sendChatMessage(orderNumber: string, message: string) {
    return this.privateRequest("/sapi/v1/c2c/chat/sendMessage", {}, { orderNumber, message }, true);
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
