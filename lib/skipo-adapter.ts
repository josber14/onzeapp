import { sign } from "crypto";

// Cliente de la API de Skipo (cotización/compra de USDT al mayor) — mismo
// patrón de firma que documenta Skipo: SHA256withRSA sobre
// "{METHOD} {path} {sorted_alphabetically_body}", header X-SIGNATURE en
// base64. Confirmado en vivo (jul 2026): X-API-KEY + X-SIGNATURE con este
// esquema exacto funcionan contra /v1/converts/quotations.
const BASE_URL = "https://api.skipo.com";

function sortObjectKeys(obj: Record<string, any>): Record<string, any> {
  return Object.keys(obj)
    .sort()
    .reduce((result: Record<string, any>, key: string) => {
      result[key] = obj[key];
      return result;
    }, {});
}

function getPrivateKeyPem(): string {
  const b64 = process.env.SKIPO_PRIVATE_KEY_B64;
  if (!b64) throw new Error("SKIPO_PRIVATE_KEY_B64 no definido");
  return Buffer.from(b64, "base64").toString("utf8");
}

export class SkipoClient {
  private apiKey: string;
  private privateKeyPem: string;

  constructor(apiKey?: string, privateKeyPem?: string) {
    this.apiKey = apiKey || process.env.SKIPO_API_KEY || "";
    this.privateKeyPem = privateKeyPem || getPrivateKeyPem();
    if (!this.apiKey) throw new Error("SKIPO_API_KEY no definido");
  }

  private async request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: Record<string, any> = {}): Promise<any> {
    const headers: Record<string, string> = { "X-API-KEY": this.apiKey, "Content-Type": "application/json" };
    let bodyStr = "{}";
    if (method !== "GET") {
      bodyStr = JSON.stringify(sortObjectKeys(body));
      const message = `${method} ${path} ${bodyStr}`;
      headers["X-SIGNATURE"] = sign("sha256", Buffer.from(message), this.privateKeyPem).toString("base64");
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : bodyStr,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no-JSON */ }
    if (!res.ok) {
      const msg = data?.message || text || `HTTP ${res.status}`;
      throw new Error(`Skipo error (${res.status}) en ${path}: ${msg}`);
    }
    return data;
  }

  async getCurrentUser() {
    return this.request("GET", "/v1/users/current");
  }

  async getBalances(): Promise<Array<{ currency: string; balance: number; balanceFrozen: number; balancePending: number; type: string; balanceUSD: number }>> {
    return this.request("GET", "/v1/currencies/balances");
  }

  async getSupportedMarkets(page = 1) {
    return this.request("GET", `/v1/supported_markets?page=${page}`);
  }

  // Cotización puntual — NO ejecuta nada, solo pregunta el precio. El ordId
  // que devuelve tiene una ventana corta de validez antes de que haya que
  // volver a cotizar (mismo concepto que el contador de 5s de su web).
  async getQuotation(params: {
    baseCurrencyId: string;
    quoteCurrencyId: string;
    qtyCurrencyId: string;
    side: "BUY" | "SELL";
    quantity: string;
  }): Promise<{ ordId: string; rate: string; baseQty: string; quoteQty: string; createdAt: string }> {
    return this.request("POST", "/v1/converts/quotations", params);
  }

  // Confirma y EJECUTA la cotización — esto sí mueve dinero real de forma
  // irreversible. Nunca llamar sin que medie una confirmación explícita del
  // operador.
  async confirmQuotation(ordId: string): Promise<{ ordId: string; transactionId: string; buyConvertId: string; sellConvertId: string }> {
    return this.request("POST", "/v1/converts/quotations:confirm", { ordId });
  }

  async getConverts(page = 1) {
    return this.request("GET", `/v1/converts?page=${page}`);
  }

  async getConvertById(id: string) {
    return this.request("GET", `/v1/converts/id/${id}`);
  }
}
