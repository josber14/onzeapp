import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";

async function main() {
  config({ path: ".env" });
  config({ path: ".env.local", override: true });

  const { prisma } = await import("../lib/prisma.ts");

  const id = Number(process.argv[2] || 12);

  const list = await prisma.rateList.findUnique({
    where: { id },
    include: {
      ownerUser: true,
      tenant: true,
      pairs: {
        orderBy: { sortOrder: "asc" },
        include: {
          originCountry: true,
          destinationCountry: true
        }
      }
    }
  });

  if (!list) {
    throw new Error(`No encontré RateList ID ${id}`);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    sourceId: list.id,
    name: list.name,
    active: list.active,
    defaultProfitPct: String(list.defaultProfitPct ?? "0"),
    notes: list.notes,
    ownerEmail: list.ownerUser?.email || null,
    tenantCode: list.tenant?.code || null,
    tenantTradeName: list.tenant?.tradeName || null,
    tenantLegalName: list.tenant?.legalName || null,
    pairs: list.pairs.map((p) => ({
      sortOrder: p.sortOrder,
      customProfitPct: p.customProfitPct == null ? null : String(p.customProfitPct),
      origin: {
        name: p.originCountry.name,
        code: p.originCountry.code,
        currencyCode: p.originCountry.currencyCode
      },
      destination: {
        name: p.destinationCountry.name,
        code: p.destinationCountry.code,
        currencyCode: p.destinationCountry.currencyCode
      }
    }))
  };

  mkdirSync("exports", { recursive: true });
  writeFileSync("exports/rate-list-12.json", JSON.stringify(payload, null, 2), "utf-8");

  console.log("OK: exportada en exports/rate-list-12.json");
  console.log(`Lista: ${payload.name}`);
  console.log(`Pares: ${payload.pairs.length}`);
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });
