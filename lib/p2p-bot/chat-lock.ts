import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Bloqueo real en base de datos (no en memoria) — Vercel puede levantar
// varias instancias del mismo servidor en paralelo, cada una con su propia
// memoria aislada, así que un lock en memoria de una instancia no lo ve otra.
// Confirmado en vivo jul 2026.
// Hallazgo real en vivo (ago 2026): con 15s, el lock podía expirar y
// liberarse MIENTRAS un envío legítimo todavía estaba en curso (sendAndTrack
// puede tardar 2-5s de espera humana + hasta 2 intentos de WS con 3s de
// pausa entre ellos = fácil superar 15s) -- el siguiente ciclo entraba a
// procesar la MISMA orden de nuevo antes de que la primera instancia
// alcanzara a guardar que ya había mandado el mensaje, mandándolo otra vez.
// Confirmado con un caso real: el mismo aviso se le mandó 10 veces al mismo
// comprador en espacios de ~20s (justo el intervalo normal de ciclo),
// arriesgando que Binance marque la cuenta como spam. processOrderLocked ya
// usa 35s como su propio salvavidas para un cuelgue real -- el lock debe
// durar MÁS que eso, nunca menos, para que sea siempre el timeout externo
// (no este) el que detecte un cuelgue de verdad.
const LOCK_TTL_MS = 40000; // si una instancia se cae a mitad de proceso, el lock se autolibera solo tras 40s

export async function acquireChatLock(key: string): Promise<boolean> {
  const now = new Date();
  const expiredBefore = new Date(now.getTime() - LOCK_TTL_MS);
  // Libera locks vencidos (instancia que se cayó sin liberar) antes de intentar tomar el propio.
  await prisma.chatProcessingLock.deleteMany({ where: { id: key, lockedAt: { lt: expiredBefore } } });
  try {
    // INSERT puro: si otra instancia ya tiene el lock vigente, esto choca con
    // la primary key y Postgres lo rechaza — es atómico entre instancias,
    // a diferencia de un Set en memoria.
    await prisma.chatProcessingLock.create({ data: { id: key, lockedAt: now } });
    return true;
  } catch (e: any) {
    // P2002 = violación de constraint única = alguien más YA tiene el lock,
    // caso esperado. Cualquier OTRO error (conexión, timeout del pool de
    // Neon, etc.) es un problema real y NO debe esconderse como "otra
    // instancia lo tiene" — confirmado en vivo jul 2026: la tabla de locks
    // estaba vacía pero cada intento igual fallaba, porque un error distinto
    // se estaba tragando en silencio acá y reportándose como "ya bloqueado".
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false;
    }
    throw e;
  }
}

export async function releaseChatLock(key: string): Promise<void> {
  await prisma.chatProcessingLock.delete({ where: { id: key } }).catch(() => {});
}
