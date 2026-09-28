// Bybit tiene "IP restrict" activado en la API key del usuario (whitelist a
// una sola IP de su casa/oficina) -- Vercel (plan Pro) no ofrece una IP de
// salida fija, así que las llamadas fallaban intermitentemente con
// "10010: Unmatched IP, please check your API key's bound IP addresses"
// (a veces salían por una IP distinta a la permitida).
//
// Arreglo: mismo droplet de DigitalOcean en Singapur (IP fija) que ya usa
// Binance para su mismo problema, pero en el PUERTO 8443 (no el 443 de
// Binance). La firma HMAC del request ya se calculó acá antes de salir, así
// que el proxy solo reenvía bytes -- Bybit ve el request como si viniera de
// la IP fija del droplet. Confirmado en vivo (sep 2026) que Bybit no bloquea
// Singapur por país (a diferencia de Binance, que bloquea EE.UU. -- ver
// binance-proxy.ts).
//
// Primer intento (compartir el puerto 443 con Binance, enrutando por SNI --
// "onze-bybit-proxy" vs "onze-binance-proxy") NO funcionó: confirmado en
// vivo con los logs del propio nginx que el request real de la app (Node/
// undici, destino la IP pelada del droplet, sin nombre de dominio) caía en
// el bloque de Binance en vez del de Bybit -- Binance devolvía 403 vacío a
// una ruta de Bybit que no le correspondía, un error que parecía "Bybit
// bloqueando todo" pero en realidad ni siquiera llegaba a Bybit. Un curl de
// prueba (mismo droplet, misma firma real) SÍ mandaba el SNI correcto y
// funcionaba perfecto -- la diferencia está en cómo undici arma la conexión
// TLS cuando el destino es una IP literal (no un hostname), no en Bybit ni
// en la API key. Un puerto dedicado elimina esa ambigüedad por completo.
//
// El proxy usa un certificado TLS autofirmado propio (CN=onze-bybit-proxy,
// distinto del de Binance) -- BYBIT_PROXY_CA es ese certificado.
//
// Si BYBIT_PROXY_URL no está seteada (dev local), todo sigue pegándole
// directo a api.bybit.com como siempre -- este módulo no cambia nada por
// default.

import { Agent, fetch as undiciFetch } from "undici";

const PROXY_URL = process.env.BYBIT_PROXY_URL?.replace(/\/+$/, "");
const PROXY_CA = process.env.BYBIT_PROXY_CA;
const PROXY_SNI = "onze-bybit-proxy"; // debe matchear el CN del cert autofirmado del proxy

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

// Base URL para armar las URLs de Bybit (reemplaza el hardcode de
// "https://api.bybit.com" en bybit-adapter.ts). El testnet nunca pasa por
// acá -- no tiene sentido restringir por IP un ambiente de pruebas.
export function bybitApiBase(): string {
  return proxyEnabled ? PROXY_URL! : "https://api.bybit.com";
}

// Reemplazo de `fetch` para llamadas a Bybit -- cuando hay proxy
// configurado, fuerza la conexión TLS a validar contra el cert autofirmado
// del droplet en vez del cert público que tendría api.bybit.com.
export async function bybitFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  if (!proxyEnabled) return fetch(url, opts);
  return undiciFetch(url, { ...(opts as any), dispatcher: getProxyAgent() }) as unknown as Promise<Response>;
}
