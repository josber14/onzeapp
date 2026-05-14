import { config } from "dotenv";
import { readFileSync } from "fs";

type ExportedPair = {
  sortOrder: number;
  customProfitPct: string | null;
  origin: { name: string; code: string; currencyCode: string };
  destination: { name: string; code: string; currencyCode: string };
};

type ExportedRateList = {
  name: string;
  active: boolean;
  defaultProfitPct: string;
  notes: string | null;
  ownerEmail: string | null;
  tenantCode: string | null;
  tenantTradeName: string | null;
  tenantLegalName: string | null;
  pairs: ExportedPair[];
};

async function main() {
  config({ path: ".env.production.local", override: true });

  const { prisma } = await import("../lib/prisma.ts");

  const payload = JSON.parse(
    readFileSync("exports/rate-list-12.json", "utf-8")
  ) as ExportedRateList;

  if (!payload.ownerEmail) {
    throw new Error("El export no tiene ownerEmail.");
  }

  const ownerUser = await prisma.user.findUnique({
    where: { email: payload.ownerEmail },
  });

  if (!ownerUser) {
    throw new Error(`No encontré el usuario dueño en producción: ${payload.ownerEmail}`);
  }

  const tenant =
    (payload.tenantCode
      ? await prisma.tenant.findFirst({ where: { code: payload.tenantCode } })
      : null) ||
    (payload.tenantTradeName
      ? await prisma.tenant.findFirst({ where: { tradeName: payload.tenantTradeName } })
      : null) ||
    (payload.tenantLegalName
      ? await prisma.tenant.findFirst({ where: { legalName: payload.tenantLegalName } })
      : null);

  if (!tenant) {
    throw new Error("No encontré el tenant ONZE en producción.");
  }

  const existing = await prisma.rateList.findFirst({
    where: {
      tenantId: tenant.id,
      ownerUserId: ownerUser.id,
      name: payload.name,
    },
    include: { pairs: true },
  });

  const rateList = existing
    ? await prisma.rateList.update({
        where: { id: existing.id },
        data: {
          active: payload.active,
          defaultProfitPct: payload.defaultProfitPct,
          notes: payload.notes,
        },
      })
    : await prisma.rateList.create({
        data: {
          tenantId: tenant.id,
          ownerUserId: ownerUser.id,
          name: payload.name,
          active: payload.active,
          defaultProfitPct: payload.defaultProfitPct,
          notes: payload.notes,
        },
      });

  await prisma.rateListPair.deleteMany({
    where: { rateListId: rateList.id },
  });

  for (const pair of payload.pairs) {
    const originCountry =
      (pair.origin.code
        ? await prisma.country.findFirst({ where: { code: pair.origin.code } })
        : null) ||
      (await prisma.country.findFirst({ where: { name: pair.origin.name } }));

    const destinationCountry =
      (pair.destination.code
        ? await prisma.country.findFirst({ where: { code: pair.destination.code } })
        : null) ||
      (await prisma.country.findFirst({ where: { name: pair.destination.name } }));

    if (!originCountry || !destinationCountry) {
      throw new Error(
        `No encontré país para par: ${pair.origin.name} -> ${pair.destination.name}`
      );
    }

    await prisma.rateListPair.create({
      data: {
        rateListId: rateList.id,
        originCountryId: originCountry.id,
        destinationCountryId: destinationCountry.id,
        sortOrder: pair.sortOrder,
        customProfitPct: pair.customProfitPct,
      },
    });
  }

  const finalList = await prisma.rateList.findUnique({
    where: { id: rateList.id },
    include: { pairs: true },
  });

  console.log("OK: lista importada en producción");
  console.log(`ID producción: ${rateList.id}`);
  console.log(`Nombre: ${rateList.name}`);
  console.log(`Pares: ${finalList?.pairs.length || 0}`);
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });
