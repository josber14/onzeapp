import { prisma } from "@/lib/prisma";

export async function getBinanceCredentials(tenantId: number) {
  return prisma.binanceCredentials.findUnique({ where: { tenantId } });
}

export async function saveBinanceCredentials(tenantId: number, apiKey: string, secretKey: string) {
  await prisma.binanceCredentials.upsert({
    where: { tenantId },
    update: { apiKey, secretKey, isActive: true },
    create: { tenantId, apiKey, secretKey, isActive: true },
  });
}

export async function testBinanceCredentials(tenantId: number) {
  try {
    const creds = await getBinanceCredentials(tenantId);
    if (!creds) return { ok: false, error: "No credentials" };
    await prisma.binanceCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.binanceCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "failed" },
    });
    return { ok: false, error: e.message };
  }
}
