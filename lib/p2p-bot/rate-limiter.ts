// Autolímite propio para /sapi/v1/c2c/ads/update — Binance confirmó (soporte,
// jul 2026) que ese endpoint (junto con /sapi/v1/c2c/ads/updateStatus) tiene un
// límite de 36 llamadas por minuto POR CUENTA (ID de usuario), no revelado hasta
// ahora. Cada label (ONZE/ZINPLE) es una cuenta de Binance distinta, así que se
// cuenta por separado.
//
// En vez de mandar la llamada y reaccionar recién cuando Binance la rechaza con
// 187049/187040, este módulo lleva la cuenta de cuántas llamadas se hicieron en
// los últimos 60 segundos y avisa ANTES de mandar una nueva si ya no hay cupo —
// dejando margen (CAP < 36) para acciones manuales que el usuario pueda hacer en
// paralelo en la app/web de Binance, que cuentan contra el mismo límite.

const WINDOW_MS = 60_000;
const CAP = 32; // margen de 4 sobre el límite real de 36, para acciones manuales en paralelo
const DOWN_MOVE_RESERVE = 4; // cupos reservados exclusivamente para subidas de precio / recuperación

const callLog = new Map<string, number[]>();

function prune(key: string): number[] {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let arr = callLog.get(key);
  if (!arr) {
    arr = [];
    callLog.set(key, arr);
  }
  if (arr.length > 0 && arr[0] < cutoff) {
    arr = arr.filter(t => t > cutoff);
    callLog.set(key, arr);
  }
  return arr;
}

// Llamadas "prioritarias": subir precio, sincronizar cantidad, ocultar/mostrar
// el anuncio en una emergencia. Solo se bloquean si de verdad no queda ningún
// cupo (protege el límite real de Binance, nunca lo supera).
export function canCallPriority(key: string): boolean {
  return prune(key).length < CAP;
}

// Llamadas "no urgentes": bajar precio persiguiendo a un competidor. Se
// bloquean antes, dejando DOWN_MOVE_RESERVE cupos libres para las prioritarias.
export function canCallNonUrgent(key: string): boolean {
  return prune(key).length < (CAP - DOWN_MOVE_RESERVE);
}

export function recordCall(key: string): void {
  prune(key).push(Date.now());
}

export function getUsage(key: string): { used: number; cap: number; reserved: number; resetInMs: number } {
  const arr = prune(key);
  const resetInMs = arr.length > 0 ? Math.max(0, WINDOW_MS - (Date.now() - arr[0])) : 0;
  return { used: arr.length, cap: CAP, reserved: DOWN_MOVE_RESERVE, resetInMs };
}
