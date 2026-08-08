import { sign, createHash, randomUUID, createPrivateKey } from "crypto";
import { SignJWT } from "jose";

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
      // Mostrar el cuerpo COMPLETO del error (no solo .message) — Skipo a
      // veces manda detalle útil en otros campos (ej. errors, details, code)
      // que .message por sí solo no revela.
      const msg = data ? JSON.stringify(data) : (text || `HTTP ${res.status}`);
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

// ─── Cliente API v2 (retiros) ──────────────────────────────────────────
// Sistema de credenciales TOTALMENTE separado del v1 de arriba (confirmado
// en la guía oficial de migración de Skipo, ago 2026): "el esquema antiguo
// (X-API-KEY + firma RSA x509) desaparece en v2". v2 usa dos niveles:
//   - Tier-1 (lecturas): Authorization: Bearer skp_live_... -- la llave sola.
//   - Tier-2 (mueve dinero, ej. retiros): X-API-Key: skp_live_... +
//     Authorization: Bearer <JWT firmado Ed25519>, con claims sub/uri/nonce/
//     iat/exp (exp-iat<=60s)/bodyHash (SHA-256 hex del body crudo).
// Confirmado en vivo (ago 2026): la llave nueva + esta llave pública Ed25519
// ya subida al panel de Skipo devuelven 200 real contra GET /v2/contacts.
const SKIPO_V2_BASE_URL = "https://api.skipo.com";

function getSkipoV2PrivateKeyPem(): string {
  const b64 = process.env.SKIPO_V2_PRIVATE_KEY_B64;
  if (!b64) throw new Error("SKIPO_V2_PRIVATE_KEY_B64 no definido");
  return Buffer.from(b64, "base64").toString("utf8");
}

export interface SkipoContact {
  id: string;
  reference: string | null;
  alias: string;
  type: "INTERNAL" | "EXTERNAL_CRYPTO" | "BANK_ACCOUNT" | string;
  crypto?: { assetSymbol: string; assetName?: string; networkSymbol: string; networkName?: string; address: string; tag?: string | null };
}

export interface SkipoWithdrawal {
  id: string;
  type: string;
  subType: string;
  assetSymbol: string;
  amount: string;
  fee: string;
  total: string;
  status: string;
  createdAt: string;
}

export class SkipoV2Client {
  private apiKey: string;
  private privateKeyPem: string;

  constructor(apiKey?: string, privateKeyPem?: string) {
    this.apiKey = apiKey || process.env.SKIPO_V2_API_KEY || "";
    this.privateKeyPem = privateKeyPem || getSkipoV2PrivateKeyPem();
    if (!this.apiKey) throw new Error("SKIPO_V2_API_KEY no definido");
  }

  // Tier-1: la llave sola, para GET/lecturas.
  private async requestRead(method: "GET", path: string): Promise<any> {
    const res = await fetch(`${SKIPO_V2_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return this.parseResponse(res, path);
  }

  // Causa raíz real confirmada por soporte de Skipo (ago 2026, tras varios
  // días con "Unknown API key" / "Malformed API key" en /v2/withdrawals):
  // el header X-API-Key (y el claim "sub" del JWT) esperan solo el PREFIJO
  // público de la llave -- los primeros 21 caracteres ("skp_live_" + 12 más),
  // NUNCA la llave secreta completa. Mandábamos la llave entera en los dos
  // -- Skipo nunca la reconocía como un prefijo válido porque era demasiado
  // larga, de ahí el error. El Bearer de las lecturas (tier-1, requestRead)
  // SÍ sigue siendo la llave completa -- ese es un esquema distinto, no se
  // toca acá.
  private get apiKeyPrefix(): string {
    return this.apiKey.slice(0, 21);
  }

  // Tier-2: firma JWT por petición -- ver comentario de arriba. El body se
  // serializa UNA sola vez (bodyBytes) y esos mismos bytes son los que se
  // hashean Y los que se envían -- reserializar después de firmar invalida
  // el bodyHash (documentado explícitamente por Skipo).
  private async requestSigned(method: "POST" | "PATCH" | "DELETE", path: string, body: Record<string, any> = {}): Promise<any> {
    const bodyBytes = JSON.stringify(body);
    const bodyHash = createHash("sha256").update(Buffer.from(bodyBytes, "utf8")).digest("hex");
    const now = Math.floor(Date.now() / 1000);
    const key = createPrivateKey(this.privateKeyPem);
    const jwt = await new SignJWT({ uri: `${method} ${path}`, nonce: randomUUID(), bodyHash })
      .setProtectedHeader({ alg: "EdDSA" })
      .setSubject(this.apiKeyPrefix)
      .setIssuedAt(now)
      .setExpirationTime(now + 55)
      .sign(key);

    const res = await fetch(`${SKIPO_V2_BASE_URL}${path}`, {
      method,
      headers: {
        "X-API-Key": this.apiKeyPrefix,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: bodyBytes,
    });
    return this.parseResponse(res, path);
  }

  private async parseResponse(res: Response, path: string): Promise<any> {
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no-JSON */ }
    if (!res.ok) {
      const msg = data ? JSON.stringify(data) : (text || `HTTP ${res.status}`);
      // OJO: este mensaje SIEMPRE queda server-side (logs, console.error) --
      // nunca reenviar tal cual al cliente, contiene el nombre del proveedor
      // y su dominio. Ver toClient* en lib/usdt-purchase.ts.
      throw new Error(`Skipo v2 error (${res.status}) en ${path}: ${msg}`);
    }
    return data;
  }

  async getContacts(): Promise<{ data: SkipoContact[]; pagination: any }> {
    return this.requestRead("GET", "/v2/contacts");
  }

  async getContact(contactId: string): Promise<SkipoContact> {
    return this.requestRead("GET", `/v2/contacts/${contactId}`);
  }

  // Ejecuta el retiro real -- mueve dinero de forma irreversible. Nunca
  // llamar sin que medie una confirmación explícita del cliente (2FA) y,
  // mientras se prueba por primera vez, del operador.
  //
  // El campo se llama "assetSymbol", NUNCA "asset" -- confirmado en vivo
  // (ago 2026) por el propio error 400 de Skipo ("property asset should
  // not exist; assetSymbol should not be empty") tras resolver el 401 de
  // autenticación. La doc/OpenAPI pública decía "asset" en el momento en
  // que se leyó -- el servidor real manda, no el doc.
  async createWithdrawal(params: { asset: string; amount: string; contactId: string }): Promise<SkipoWithdrawal> {
    return this.requestSigned("POST", "/v2/withdrawals", {
      assetSymbol: params.asset,
      amount: params.amount,
      contactId: params.contactId,
    });
  }

  async getWithdrawal(id: string): Promise<SkipoWithdrawal> {
    return this.requestRead("GET", `/v2/withdrawals/${id}`);
  }

  // Mínimo y comisión de retiro REALES de la cuenta -- confirmado en vivo
  // (ago 2026) contra GET /v2/assets/USDT: minimumWithdrawal="5",
  // withdrawalFee="0.5" (BEP20). Se piden en vivo en vez de fijarlos a mano
  // en el código porque Skipo puede cambiarlos sin avisar.
  async getAssetInfo(assetSymbol: string): Promise<{
    assetSymbol: string;
    minimumWithdrawal: string;
    withdrawalFee: string;
    networks: Array<{ networkSymbol: string; networkName: string; withdrawalFee: string }>;
  }> {
    return this.requestRead("GET", `/v2/assets/${assetSymbol}`);
  }
}
