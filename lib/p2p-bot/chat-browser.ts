import { prisma } from "@/lib/prisma";

const BAPI_BASE = "https://p2p.binance.com";

// Known BAPI endpoints for sending chat messages (tried in order)
const BAPI_ENDPOINTS = [
  "/bapi/c2c/v2/private/chat/send",
  "/bapi/c2c/v2/private/chat/sendMessage",
  "/bapi/c2c/v2/private/chat/message/send",
  "/bapi/c2c/v3/private/chat/send",
  "/bapi/c2c/v2/private/chat/message/sendMessage",
  "/bapi/c2c/v2/private/chat/message/send/message",
  "/bapi/c2c/v2/private/chat/send/message",
  "/gateway-api/v2/private/c2c/chat/send",
  "/gateway-api/v1/private/c2c/chat/message/send",
];

function parseCookies(cookieJson: string): string {
  try {
    const arr = JSON.parse(cookieJson);
    if (!Array.isArray(arr)) return cookieJson;
    return arr
      .filter((c: any) => c.name && c.value)
      .map((c: any) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return cookieJson;
  }
}

function extractCsrfToken(cookieHeader: string): string | null {
  // Try csrftoken cookie first
  const match = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  if (match) return match[1];
  // Try bnc-csrftoken
  const match2 = cookieHeader.match(/(?:^|;\s*)bnc-csrftoken=([^;]+)/);
  if (match2) return match2[1];
  return null;
}

export async function sendChatViaBAPI(
  orderNo: string,
  content: string,
  cookieHeader: string
): Promise<{ ok: boolean; error?: string }> {
  const body = { orderNo, content };
  const csrfToken = extractCsrfToken(cookieHeader);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "clientType": "web",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Origin": "https://p2p.binance.com",
    "Referer": "https://p2p.binance.com/",
    "Accept": "*/*",
    "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
    headers["X-CSRF-TOKEN"] = csrfToken;
  }

  let lastErr = "";
  for (const ep of BAPI_ENDPOINTS) {
    try {
      const res = await fetch(`${BAPI_BASE}${ep}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (data?.success === true || data?.code === "000000") {
        return { ok: true };
      }
      if (res.status === 401 || data?.code === "100001005") {
        lastErr = "Cookies expiradas — renueva las cookies en el panel";
      } else {
        lastErr = data?.message || data?.msg || `HTTP ${res.status}`;
      }
    } catch (e: any) {
      lastErr = e.message;
    }
  }
  return { ok: false, error: lastErr };
}

export async function getStoredCookies(tenantId: number): Promise<string | null> {
  const cfg = await prisma.p2PBotExchangeConfig.findUnique({
    where: { tenantId_exchange: { tenantId, exchange: "binance" } },
  });
  if (!cfg?.chatCookies) return null;
  const raw = cfg.chatCookies as any;
  if (typeof raw === "string") return parseCookies(raw);
  if (Array.isArray(raw)) return raw.map((c: any) => `${c.name}=${c.value}`).join("; ");
  if (raw.cookies) {
    return raw.cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
  }
  return null;
}

export async function getStorageState(tenantId: number): Promise<{ cookies: any[]; origins?: any[] } | null> {
  const cfg = await prisma.p2PBotExchangeConfig.findUnique({
    where: { tenantId_exchange: { tenantId, exchange: "binance" } },
  });
  if (!cfg?.chatCookies) return null;
  const raw = cfg.chatCookies as any;
  if (typeof raw === "object" && raw !== null && raw.cookies) {
    return raw as { cookies: any[]; origins?: any[] };
  }
  return null;
}

export async function storeCookies(tenantId: number, data: string | { cookies: any[]; origins?: any[] }): Promise<void> {
  await prisma.p2PBotExchangeConfig.upsert({
    where: { tenantId_exchange: { tenantId, exchange: "binance" } },
    update: { chatCookies: data as any },
    create: { tenantId, exchange: "binance", chatCookies: data as any },
  });
}
