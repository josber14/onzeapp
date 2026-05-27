import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";

export async function getBybitCredentials(tenantId: number) {
  return prisma.bybitCredentials.findUnique({ where: { tenantId } });
}

export async function saveBybitCredentials(
  tenantId: number,
  apiKey: string,
  secretKey: string
) {
  await prisma.bybitCredentials.upsert({
    where: { tenantId },
    update: { apiKey, secretKey, isActive: true },
    create: { tenantId, apiKey, secretKey, isActive: true },
  });
}

export async function testBybitCredentials(tenantId: number) {
  try {
    const creds = await getBybitCredentials(tenantId);
    if (!creds) return { ok: false, error: "No credentials" };
    const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
    await client.getAccountInfo();
    await prisma.bybitCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.bybitCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "failed" },
    });
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
  payments: string[];
  paymentPeriod: number;
  remark?: string;
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

export class BybitP2PClient {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;
  private recvWindow = "5000";

  constructor(apiKey: string, secretKey: string, testnet?: boolean) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com";
  }

  private sign(timestamp: string, payload: string): string {
    const str = timestamp + this.apiKey + this.recvWindow + payload;
    return createHmac("sha256", this.secretKey).update(str).digest("hex");
  }

  private async request(endpoint: string, body: Record<string, any> = {}, method = "POST"): Promise<any> {
    const timestamp = Date.now().toString();
    const isGet = method === "GET";
    const sortedKeys = isGet ? Object.keys(body).sort() : [];
    const queryStr = isGet && sortedKeys.length ? "?" + sortedKeys.map(k => `${k}=${encodeURIComponent(body[k])}`).join("&") : "";
    const payload = isGet ? queryStr.slice(1) : JSON.stringify(body);
    const signature = this.sign(timestamp, payload);

    const res = await fetch(this.baseUrl + endpoint + queryStr, {
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
    const data = JSON.parse(text);
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

  async sendChatMessage(orderId: string, message: string) {
    return this.request("/v5/p2p/order/chatSend", { orderId, message });
  }

  async getChatMessages(orderId: string, page = 1, size = 20) {
    return this.request("/v5/p2p/order/chatMsg", { orderId, page, size });
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
    page?: number;
    size?: number;
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
