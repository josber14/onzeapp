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
//
// Pedido explícito del usuario (ago 2026): automatizar el bot con un cron de
// Vercel (para que corra sin depender de tener el panel abierto en un
// navegador) significa que este código puede correr en instancias serverless
// que NO se mantienen vivas entre invocaciones -- un Map en memoria del
// proceso se resetearía solo en cada invocación fría, dejando de proteger la
// cuenta contra el mismo tipo de bloqueo real que ya pasó una vez (ver
// AGENTS.md). Por eso el registro de llamadas ahora vive en la base de datos
// (modelo P2PBotCallLog) en vez de en memoria -- una fila por llamada real,
// se cuenta cuántas hay en la ventana de 60s. Las funciones pasan a ser
// async por este cambio (antes eran síncronas).

import { prisma } from "@/lib/prisma";

const WINDOW_MS = 60_000;
const CAP = 32; // margen de 4 sobre el límite real de 36, para acciones manuales en paralelo
const DOWN_MOVE_RESERVE = 4; // cupos reservados exclusivamente para subidas de precio / recuperación

// key = `${tenantId}:${label}` (mismo formato que rateLimitKey en
// runBinanceCycle, engine.ts) -- este módulo es específico de Binance (ver
// comentario de arriba), así que exchange queda fijo.
const EXCHANGE = "binance";
function parseKey(key: string): { tenantId: number; label: string; exchange: string } {
  const [tenantIdStr, label] = key.split(":");
  return { tenantId: Number(tenantIdStr), label: label || "ONZE", exchange: EXCHANGE };
}

async function countRecentCalls(key: string): Promise<number> {
  const { tenantId, label, exchange } = parseKey(key);
  const cutoff = new Date(Date.now() - WINDOW_MS);
  // Limpieza oportunista de filas viejas (>2 min) -- no bloquea el conteo,
  // solo evita que la tabla crezca sin límite. Falla en silencio: si esto
  // no corre en un ciclo puntual, no afecta la protección real (el conteo
  // de abajo igual solo mira la ventana de 60s).
  prisma.p2PBotCallLog
    .deleteMany({ where: { tenantId, label, exchange, calledAt: { lt: new Date(Date.now() - 2 * WINDOW_MS) } } })
    .catch(() => {});
  return prisma.p2PBotCallLog.count({ where: { tenantId, label, exchange, calledAt: { gte: cutoff } } });
}

// Llamadas "prioritarias": subir precio, sincronizar cantidad, ocultar/mostrar
// el anuncio en una emergencia. Solo se bloquean si de verdad no queda ningún
// cupo (protege el límite real de Binance, nunca lo supera).
export async function canCallPriority(key: string): Promise<boolean> {
  return (await countRecentCalls(key)) < CAP;
}

// Llamadas "no urgentes": bajar precio persiguiendo a un competidor. Se
// bloquean antes, dejando DOWN_MOVE_RESERVE cupos libres para las prioritarias.
export async function canCallNonUrgent(key: string): Promise<boolean> {
  return (await countRecentCalls(key)) < (CAP - DOWN_MOVE_RESERVE);
}

export async function recordCall(key: string): Promise<void> {
  const { tenantId, label, exchange } = parseKey(key);
  await prisma.p2PBotCallLog.create({ data: { tenantId, label, exchange } });
}

export async function getUsage(key: string): Promise<{ used: number; cap: number; reserved: number; resetInMs: number }> {
  const { tenantId, label, exchange } = parseKey(key);
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const [used, oldest] = await Promise.all([
    prisma.p2PBotCallLog.count({ where: { tenantId, label, exchange, calledAt: { gte: cutoff } } }),
    prisma.p2PBotCallLog.findFirst({ where: { tenantId, label, exchange, calledAt: { gte: cutoff } }, orderBy: { calledAt: "asc" }, select: { calledAt: true } }),
  ]);
  const resetInMs = oldest ? Math.max(0, WINDOW_MS - (Date.now() - oldest.calledAt.getTime())) : 0;
  return { used, cap: CAP, reserved: DOWN_MOVE_RESERVE, resetInMs };
}
