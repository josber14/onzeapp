import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";

export async function getBinanceCredentials(tenantId: number) {
  return prisma.binanceCredentials.findUnique({ where: { tenantId } });
}

export async function saveBinanceCredentials(tenantId: number, apiKey: string, secretKey: string) {
  await prisma.binanceCredentials.upsert({
    where: { tenantId },
    update: { apiKey, secretKey, isActive: true },
    create: { tenantId, apiKey, secretKey, isActive: true },
  });
}

export async function testBinanceCredentials(tenantId: number) {
  try {
    const creds = await getBinanceCredentials(tenantId);
    if (!creds) return { ok: false, error: "No credentials" };
    await prisma.binanceCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.binanceCredentials.update({
      where: { tenantId },
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

  private async privateRequest(endpoint: string, params: Record<string, any> = {}, bodyPayload?: any, paramsInBody = false): Promise<any> {
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
      },
    };
    if (bodyPayload) opts.body = JSON.stringify(bodyPayload);

    const res = await fetch(url, opts);
    const text = await res.text();
    if (!text) throw new Error(`Binance empty response (HTTP ${res.status}) for ${endpoint}`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Binance respuesta inválida (HTTP ${res.status}) para ${endpoint}: ${text.slice(0, 200)}`);
    }
    if (data?.code && data.code !== "000000") {
      // Log full response for debugging
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

  async getMyAds(page = 1, rows = 50) {
    return this.privateRequest("/sapi/v1/c2c/ads/listWithPagination", { page, rows }, undefined, true);
  }

  async getAdDetail(adId: string) {
    return this.privateRequest("/sapi/v1/c2c/ads/getDetailByNo", { adsNo: adId });
  }

  async postAd(params: Record<string, any>) {
    return this.privateRequest("/sapi/v1/c2c/ads/post", {}, params);
  }

  async updateAd(params: Record<string, any>) {
    const { adId, price } = params;
    const body = { advNo: String(adId), price: String(price) };
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.privateRequest("/sapi/v1/c2c/ads/update", {}, body);
      } catch (e: any) {
        lastErr = e;
        if (e.message?.includes("code: -9000")) {
          const delay = (attempt + 1) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async updateAdQuantity(adId: string, quantity: number) {
    const body: Record<string, any> = { advNo: String(adId) };
    if (quantity > 0) body.surplusAmount = String(quantity);
    try {
      return await this.privateRequest("/sapi/v1/c2c/ads/update", {}, body);
    } catch (e: any) {
      if (e.message?.includes("187049")) {
        // Binance rejects quantity update; try updating price instead to "wake up" the ad
        const detailRes = await this.getAdDetail(adId);
        const currentPrice = detailRes?.data?.adv?.price || "0";
        return await this.privateRequest("/sapi/v1/c2c/ads/update", {}, { advNo: String(adId), price: String(currentPrice) });
      }
      throw e;
    }
  }

  async removeAd(adId: string) {
    return this.privateRequest("/sapi/v1/c2c/ads/batchUpdateStatus", {}, { adsNos: [adId], advStatus: "close" });
  }

  // ─── Orders ──────────────────────────────────────────────────

  async getOrders(params: { page: number; rows: number; tradeType?: string; status?: string }) {
    return this.privateRequest("/sapi/v1/p2p/order/list", params);
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
}
