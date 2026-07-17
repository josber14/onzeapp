import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ruta de diagnóstico TEMPORAL — jul 2026, investigando por qué
// prisma.chatProcessingLock aparece undefined en producción pese a que el
// build genera el cliente correctamente. Borrar después de usar.
export async function GET() {
  try {
    const keys = Object.keys(prisma as any).filter((k) => !k.startsWith("_") && !k.startsWith("$"));
    const hasChatLock = typeof (prisma as any).chatProcessingLock;
    let dbCount: number | string = "N/A";
    try {
      dbCount = await prisma.chatProcessingLock.count();
    } catch (e: any) {
      dbCount = `ERROR: ${e.message}`;
    }
    return Response.json({
      ok: true,
      prismaKeysCount: keys.length,
      hasChatProcessingLockKey: keys.includes("chatProcessingLock"),
      typeofChatProcessingLock: hasChatLock,
      chatProcessingLockCount: dbCount,
      sampleKeys: keys.slice(0, 10),
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      vercelUrl: process.env.VERCEL_URL,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message, stack: error.stack }, { status: 500 });
  }
}
