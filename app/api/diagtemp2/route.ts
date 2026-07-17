import { prisma } from "@/lib/prisma";
import { acquireChatLock, releaseChatLock } from "@/lib/p2p-bot/chat-lock";
import { executeBotCycle } from "@/lib/p2p-bot/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ruta de diagnóstico TEMPORAL #2 — jul 2026. Borrar después de usar.
export async function GET() {
  const results: any = {};

  // 1. Prisma directo
  try {
    results.directCount = await prisma.chatProcessingLock.count();
  } catch (e: any) {
    results.directError = e.message;
  }

  // 2. acquireChatLock/releaseChatLock (misma función que falla en el bot)
  try {
    const key = "diag-test-key";
    const got = await acquireChatLock(key);
    results.acquireResult = got;
    if (got) await releaseChatLock(key);
  } catch (e: any) {
    results.acquireError = e.message;
    results.acquireStack = e.stack?.split("\n").slice(0, 5);
  }

  // 3. Confirma que engine.ts se importa sin romperse
  results.engineImportOk = typeof executeBotCycle === "function";

  return Response.json(results);
}
