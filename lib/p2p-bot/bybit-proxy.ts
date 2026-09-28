// Bybit tiene "IP restrict" activado en la API key del usuario (whitelist a
// una sola IP) -- Vercel (plan Pro) no ofrece una IP de salida fija, así que
// las llamadas fallaban con "10010: Unmatched IP, please check your API
// key's bound IP addresses".
//
// Arreglo: mismo droplet de DigitalOcean en Singapur (IP fija) que ya usa
// Binance para su mismo problema, pero en el PUERTO 8443 (no el 443 de
// Binance -- ver el comentario de más abajo sobre por qué no se comparte
// puerto). La firma HMAC del request ya se calculó acá antes de salir, así
// que el proxy solo reenvía bytes -- Bybit ve el request como si viniera de
// la IP fija del droplet. Confirmado en vivo (sep 2026) que Bybit no bloquea
// Singapur por país (a diferencia de Binance, que bloquea EE.UU. -- ver
// binance-proxy.ts).
//
// Primer intento (compartir el puerto 443 con Binance, enrutando por SNI --
// "onze-bybit-proxy" vs "onze-binance-proxy") NO funcionó: confirmado en
// vivo con los logs del propio nginx que el request real de la app (Node/
// undici, destino la IP pelada del droplet, sin nombre de dominio) caía en
// el bloque de Binance en vez del de Bybit. Un puerto dedicado elimina esa
// ambigüedad por completo.
//
// IMPORTANTE -- por qué esto NO usa variables de entorno (a diferencia de
// binance-proxy.ts): confirmado en vivo (sep 2026, con un log de
// diagnóstico temporal en producción) que Vercel, de forma intermitente,
// arranca algunos procesos del bot SIN NINGUNA variable de entorno
// personalizada -- ni siquiera BINANCE_PROXY_URL/CA, que llevan meses
// funcionando. Mismo patrón exacto de "a veces sí, a veces no" que el
// problema original de IP que este archivo soluciona. Como ni la URL del
// proxy (una IP con puerto) ni el certificado (público por definición) son
// datos secretos, se dejan FIJOS acá en vez de depender de que Vercel los
// inyecte correctamente en cada arranque -- así el proxy queda garantizado
// siempre activo, sin importar esa falla de la plataforma.
import { Agent, fetch as undiciFetch } from "undici";

const PROXY_URL = "https://178.128.221.72:8443";
const PROXY_SNI = "onze-bybit-proxy"; // debe matchear el CN del cert autofirmado del proxy
const PROXY_CA = `-----BEGIN CERTIFICATE-----
MIIDFzCCAf+gAwIBAgIUDn/fAhOCcV7Wr3PSkyIzwCCP804wDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQb256ZS1ieWJpdC1wcm94eTAeFw0yNjA5MjgxNTA0MDVa
Fw0zNjA5MjUxNTA0MDVaMBsxGTAXBgNVBAMMEG9uemUtYnliaXQtcHJveHkwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCxswcPT6QGuDzIokXgRHx/oK58
zlK/h+cV3P3IISFKTYL2SXXzxGWxVF2KomgZ18IDiR2NpRUUzo5rPDGx39OqIm3P
lfafsD02YP1jNv2EoiqEZxcYRiPWS6vtrq4UfcpLjqlqT/XZwDZp3zltKQxoiu1B
TK9W1/4AX28setsQ0+rthSNZXv8qvC3nrJWXRdPXrezgbVrU1Y7poKzsB/mRJ/j1
974X5EvBC6NqwU+WM5l5wczs8C3+REQ34fbJ1dnFQGizh9ew0uSPDuWqP6uUqB2g
wDNYbPoD7VGoLGxkErthyuU5VutkBHDTzmNQ3W7joNIqcXxfmYupmSSUkWD3AgMB
AAGjUzBRMB0GA1UdDgQWBBSI8kuyKzjAvKFE69ESzmwShPsBqDAfBgNVHSMEGDAW
gBSI8kuyKzjAvKFE69ESzmwShPsBqDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4IBAQCdEKm4ZUceHeJa0GITViO9MYb4oebC3BMkOp919dzjslNU4O6S
Zz0e2NjGGAkOSdbsAZUNcQgxt5435bB0uh27Nt7Bg1chjGrDvE5hSUvffH8zxt06
psMUpNMMvV8A6jsdRCWWgUE9jri4rAgcc6cN985ewbPj6Tu2bp0nXICrwQIVjyBh
pnkj/CXAYsLrH2uO/oQrya9rhFKr7PYosKSPLspyJUAIgP44qKeRCbEoAxtzbjr3
iAbmeJqMA2UHMcr++zPM9ScLJhECBUW7Wb0+77LMWCBj+/UdhcWS58JVqno9ccro
LZ6kJ4LkCEyHjvcaVxk5rVLduo+fVlZrcI69
-----END CERTIFICATE-----`;

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

// Base URL para armar las URLs de Bybit (reemplaza el hardcode de
// "https://api.bybit.com" en bybit-adapter.ts). El testnet nunca pasa por
// acá -- no tiene sentido restringir por IP un ambiente de pruebas.
export function bybitApiBase(): string {
  return PROXY_URL;
}

// Reemplazo de `fetch` para llamadas a Bybit -- fuerza la conexión TLS a
// validar contra el cert autofirmado del droplet en vez del cert público
// que tendría api.bybit.com.
export async function bybitFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return undiciFetch(url, { ...(opts as any), dispatcher: getProxyAgent() }) as unknown as Promise<Response>;
}
