import { createHash, randomUUID, createPrivateKey } from "crypto";
import { SignJWT } from "jose";

// ─── Cliente API v2 ──────────────────────────────────────────
// La v1 (X-API-KEY + firma RSA x509 sobre /v1/converts/*, /v1/users/current,
// etc.) fue retirada por Skipo el 10-sep-2026 -- confirmado en su guía
// oficial de migración (docs.skipo.com/migration-from-v1) y por aviso
// directo de Skipo (sep 2026, avisando que aún detectaban tráfico v1 antes
// de cortarlo del todo). v2 usa dos niveles de credenciales, TOTALMENTE
// separadas de las de v1:
//   - Tier-1 (lecturas, y también POST /v2/quotes que no mueve dinero):
//     Authorization: Bearer skp_live_... -- la llave sola.
//   - Tier-2 (mueve dinero, ej. retiros y POST /v2/orders): X-API-Key:
//     skp_live_... + Authorization: Bearer <JWT firmado Ed25519>, con claims
//     sub/uri/nonce/iat/exp (exp-iat<=60s)/bodyHash (SHA-256 hex del body
//     crudo).
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

// Cotización v2 (POST /v2/quotes) -- reemplaza a SkipoClient.getQuotation
// (v1, retirada por Skipo el 10-sep-2026). orderId es el mismo id que luego
// se manda a confirmQuotation Y el que queda como id de la orden resultante
// -- "one id, learned once, used through the whole flow" (doc oficial).
export interface SkipoV2Quote {
  orderId: string;
  market: string;
  rate: string;
  baseAmount: string;
  quoteAmount: string;
  quotedAt: string | null;
  expiresAt: string | null;
}

export interface SkipoV2OrderResult {
  orderId: string;
  transactionId: string;
}

export interface SkipoV2Order {
  id: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "FAILED";
  filledBaseAmount: string;
  filledQuoteAmount: string;
  rate: string;
}

export interface SkipoV2Balance {
  assetSymbol: string;
  balance: string;
  balanceFrozen: string;
  balancePending: string;
  balanceUSD: string;
}

export class SkipoV2Client {
  private apiKey: string;
  private privateKeyPem: string;

  constructor(apiKey?: string, privateKeyPem?: string) {
    this.apiKey = apiKey || process.env.SKIPO_V2_API_KEY || "";
    this.privateKeyPem = privateKeyPem || getSkipoV2PrivateKeyPem();
    if (!this.apiKey) throw new Error("SKIPO_V2_API_KEY no definido");
  }

  // Tier-1: la llave sola (sin firma) -- para GET/lecturas Y para POST
  // /v2/quotes, que según el OpenAPI real de Skipo también es tier-1 pese a
  // ser POST (solo cotiza, no mueve dinero -- confirmado por su propio
  // securitySchemes: bearerKey, igual que las lecturas).
  private async requestBearer(method: "GET" | "POST", path: string, body?: Record<string, any>): Promise<any> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    let bodyStr: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(body ?? {});
    }
    const res = await fetch(`${SKIPO_V2_BASE_URL}${path}`, { method, headers, body: bodyStr });
    return this.parseResponse(res, path);
  }

  // Causa raíz real confirmada por soporte de Skipo (ago 2026, tras varios
  // días con "Unknown API key" / "Malformed API key" en /v2/withdrawals):
  // el header X-API-Key (y el claim "sub" del JWT) esperan solo el PREFIJO
  // público de la llave -- los primeros 21 caracteres ("skp_live_" + 12 más),
  // NUNCA la llave secreta completa. Mandábamos la llave entera en los dos
  // -- Skipo nunca la reconocía como un prefijo válido porque era demasiado
  // larga, de ahí el error. El Bearer de las lecturas (tier-1, requestBearer)
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
    return this.requestBearer("GET", "/v2/contacts");
  }

  async getContact(contactId: string): Promise<SkipoContact> {
    return this.requestBearer("GET", `/v2/contacts/${contactId}`);
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

  // Cotización puntual (v2) -- reemplaza a SkipoClient.getQuotation (v1,
  // retirada por Skipo el 10-sep-2026). NO ejecuta nada, solo pregunta el
  // precio. expiresAt confirma lo que v1 dejaba implícito: ~5s de validez
  // antes de que haya que volver a cotizar.
  async getQuotation(params: {
    baseAsset: string;
    quoteAsset: string;
    amountAsset: string;
    side: "BUY" | "SELL";
    amount: string;
  }): Promise<SkipoV2Quote> {
    return this.requestBearer("POST", "/v2/quotes", params);
  }

  async getOrder(id: string): Promise<SkipoV2Order> {
    return this.requestBearer("GET", `/v2/orders/${id}`);
  }

  // Ejecuta la cotización -- esto SÍ mueve dinero real de forma irreversible.
  // Reemplaza a SkipoClient.confirmQuotation (v1). Confirmado con el usuario
  // (sep 2026, tras una compra real de prueba de 500 CLP): en cuentas a
  // crédito (onCredit) la orden queda "pendiente de liquidar" hasta que se
  // paga el CLP correspondiente -- eso es NORMAL, no una falla. Igual que
  // siempre funcionó con v1 (nunca se verificó ahí tampoco que llegara a
  // "FILLED"), que Skipo ACEPTE la orden (status distinto de FAILED) ya es
  // suficiente para dar la compra por completada. El aviso de Skipo de "no
  // reintentar en PROCESSING" es sobre no repetir esta llamada de creación
  // -- este método la llama una sola vez, nunca la reintenta.
  async confirmQuotation(orderId: string): Promise<SkipoV2OrderResult> {
    const placed = await this.requestSigned("POST", "/v2/orders", { orderId });
    if (placed.status === "FAILED") {
      throw new Error(`Skipo v2: la orden ${placed.id} fue rechazada (FAILED)`);
    }
    return { orderId: placed.id, transactionId: placed.transactionId || placed.id };
  }

  async getBalances(): Promise<SkipoV2Balance[]> {
    return this.requestBearer("GET", "/v2/balances");
  }

  async getWithdrawal(id: string): Promise<SkipoWithdrawal> {
    return this.requestBearer("GET", `/v2/withdrawals/${id}`);
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
    return this.requestBearer("GET", `/v2/assets/${assetSymbol}`);
  }
}
