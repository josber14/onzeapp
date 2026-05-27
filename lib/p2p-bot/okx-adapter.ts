import { prisma } from "@/lib/prisma";

export async function getOkxCredentials(tenantId: number) {
  return prisma.okxCredentials.findUnique({ where: { tenantId } });
}

export async function saveOkxCredentials(
  tenantId: number,
  apiKey: string,
  secretKey: string,
  passphrase?: string
) {
  await prisma.okxCredentials.upsert({
    where: { tenantId },
    update: { apiKey, secretKey, passphrase, isActive: true },
    create: { tenantId, apiKey, secretKey, passphrase, isActive: true },
  });
}

export async function deleteOkxCredentials(tenantId: number) {
  await prisma.okxCredentials.deleteMany({ where: { tenantId } });
}

export async function testOkxCredentials(tenantId: number) {
  try {
    const creds = await getOkxCredentials(tenantId);
    if (!creds) return { ok: false, error: "No credentials" };
    await prisma.okxCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    await prisma.okxCredentials.update({
      where: { tenantId },
      data: { lastTestedAt: new Date(), testStatus: "failed" },
    });
    return { ok: false, error: e.message };
  }
}
