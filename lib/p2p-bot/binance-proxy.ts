// Binance restringe por IP las llamadas AUTENTICADAS (X-MBX-APIKEY) a las
// API keys que el usuario tiene "IP restrict" activado en su cuenta (whitelist
// a su IP de casa). Vercel (plan Pro) no ofrece una IP de salida fija, así que
// esas llamadas fallaban con HTTP 400 code -2015 "Invalid API-key, IP, or
// permissions for action" en producción.
//
// Arreglo: un droplet de DigitalOcean en Singapur (IP fija, whitelisteada en
// Binance) corre nginx como reverse-proxy transparente hacia api.binance.com
// (proxy_pass) -- la firma HMAC del request ya se calculó acá antes de salir,
// así que el proxy solo reenvía bytes, Binance ve el request como si viniera
// de la IP del droplet. Singapur (no Nueva York) porque Binance.com bloquea
// con 451 cualquier IP de EE.UU., autenticada o no (ver AGENTS.md).
//
// El proxy usa un certificado TLS autofirmado (no hay CA pública detrás de
// una IP pelada) -- BINANCE_PROXY_CA es ese certificado, para que Node
// confíe en él sin desactivar la validación TLS global (NODE_TLS_REJECT_UNAUTHORIZED).
//
// Si BINANCE_PROXY_URL no está seteada (dev local), todo sigue pegándole
// directo a api.binance.com como siempre -- este módulo no cambia nada por
// default.

import { Agent, fetch as undiciFetch } from "undici";

const PROXY_URL = process.env.BINANCE_PROXY_URL?.replace(/\/+$/, "");
const PROXY_CA = process.env.BINANCE_PROXY_CA;
const PROXY_SNI = "onze-binance-proxy"; // debe matchear el CN del cert autofirmado del proxy

let cachedAgent: Agent | undefined;
function getProxyAgent(): Agent {
  if (!cachedAgent) {
    cachedAgent = new Agent({
      connect: {
        ca: PROXY_CA,
        servername: PROXY_SNI,
      },
    });
  }
  return cachedAgent;
}

const proxyEnabled = Boolean(PROXY_URL && PROXY_CA);

// Base URL para armar las URLs de Binance (reemplaza el hardcode de
// "https://api.binance.com" en binance-adapter.ts y en las rutas que llaman
// directo al chat/history de Binance).
export function binanceApiBase(): string {
  return proxyEnabled ? PROXY_URL! : "https://api.binance.com";
}

// Reemplazo de `fetch` para llamadas AUTENTICADAS a Binance -- cuando hay
// proxy configurado, fuerza la conexión TLS a validar contra el cert
// autofirmado del droplet en vez del cert público que tendría api.binance.com.
export async function binanceFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  if (!proxyEnabled) return fetch(url, opts);
  return undiciFetch(url, { ...(opts as any), dispatcher: getProxyAgent() }) as unknown as Promise<Response>;
}
