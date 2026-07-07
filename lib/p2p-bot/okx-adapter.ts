import { prisma } from "@/lib/prisma";

export async function getOkxCredentials(tenantId: number, label = "ONZE") {
  return prisma.okxCredentials.findFirst({
    where: { tenantId, isActive: true, label },
    orderBy: { id: "asc" },
  });
}

export async function saveOkxCredentials(
  tenantId: number,
  apiKey: string,
  secretKey: string,
  passphrase?: string,
  label = "ONZE"
) {
  const existing = await prisma.okxCredentials.findFirst({
    where: { tenantId, label },
  });
  if (existing) {
    await prisma.okxCredentials.update({
      where: { id: existing.id },
      data: { apiKey, secretKey, passphrase, isActive: true },
    });
  } else {
    await prisma.okxCredentials.create({
      data: { tenantId, label, apiKey, secretKey, passphrase, isActive: true },
    });
  }
}

export async function deleteOkxCredentials(tenantId: number, label = "ONZE") {
  await prisma.okxCredentials.deleteMany({ where: { tenantId, label } });
}

export async function testOkxCredentials(tenantId: number, label = "ONZE") {
  try {
    const creds = await getOkxCredentials(tenantId, label);
    if (!creds) return { ok: false, error: "No credentials" };
    await prisma.okxCredentials.update({
      where: { id: creds.id },
      data: { lastTestedAt: new Date(), testStatus: "success" },
    });
    return { ok: true };
  } catch (e: any) {
    const creds = await getOkxCredentials(tenantId, label);
    if (creds) {
      await prisma.okxCredentials.update({
        where: { id: creds.id },
        data: { lastTestedAt: new Date(), testStatus: "failed" },
      });
    }
    return { ok: false, error: e.message };
  }
}
