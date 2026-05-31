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
        "clientType": "web",
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
        rows: Math.min(params.rows || 50, 100),
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
    const { adId, advNo, price } = params;
    return this.privateRequest("/sapi/v1/c2c/ads/update", {}, { advNo: advNo || adId, price: String(price) });
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
    const params = { recvWindow: 60000, timestamp: Date.now(), accountType: "FUND" };
    const queryStr = this.buildQueryString(params);
    const signature = this.sign(queryStr);
    const url = `${this.apiBase}/sapi/v1/asset/transfer/query/account-balance?${queryStr}&signature=${encodeURIComponent(signature)}`;
    const res = await fetch(url, {
      headers: { "X-MBX-APIKEY": this.apiKey },
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(`Binance balance error: ${text.slice(0, 200)}`); }
    if (Array.isArray(data)) {
      const asset = data.find((b: any) => b.coin === coin);
      return { balance: asset ? [{ coin: asset.coin, balance: asset.balance }] : [] };
    }
    return data;
  }
}
