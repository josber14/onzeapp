import { prisma } from "@/lib/prisma";

export async function getBybitCredentials(tenantId: number) {
  const creds = await prisma.bybitCredentials.findUnique({
    where: { tenantId },
  });
  return creds;
}

export async function saveBybitCredentials(
  tenantId: number,
  apiKey: string,
  secretKey: string
) {
  await prisma.bybitCredentials.upsert({
    where: { tenantId },
    update: { apiKey, secretKey, isActive: true },
    create: { tenantId, apiKey, secretKey, isActive: true },
  });
}

export async function testBybitCredentials(tenantId: number) {
  try {
    const creds = await getBybitCredentials(tenantId);
    if (!creds) return { ok: false, error: "No credentials" };
    const status = "success";
    await prisma.bybitCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: status },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.bybitCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "failed" },
    });
    return { ok: false, error: e.message };
  }
}
