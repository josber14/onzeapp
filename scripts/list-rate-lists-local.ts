import { config } from "dotenv";

async function main() {
  config({ path: ".env" });
  config({ path: ".env.local", override: true });

  const { prisma } = await import("../lib/prisma.ts");

  try {
    const lists = await prisma.rateList.findMany({
      orderBy: { id: "desc" },
      include: {
        ownerUser: {
          select: { id: true, email: true, fullName: true, role: true }
        },
        tenant: {
          select: { id: true, tradeName: true, legalName: true, code: true }
        },
        pairs: {
          orderBy: { sortOrder: "asc" },
          include: {
            originCountry: true,
            destinationCountry: true
          }
        }
      }
    });

    if (!lists.length) {
      console.log("No hay listas creadas en esta base.");
      return;
    }

    for (const list of lists) {
      console.log("====================================");
      console.log(`ID: ${list.id}`);
      console.log(`Nombre: ${list.name}`);
      console.log(`Activa: ${list.active}`);
      console.log(`Tenant: ${list.tenant?.id} - ${list.tenant?.tradeName || list.tenant?.legalName || list.tenant?.code}`);
      console.log(`Dueño: ${list.ownerUser?.id} - ${list.ownerUser?.email || list.ownerUser?.fullName}`);
      console.log(`Ganancia default: ${list.defaultProfitPct}`);
      console.log(`Notas/settings: ${list.notes || ""}`);
      console.log(`Pares: ${list.pairs.length}`);

      for (const pair of list.pairs) {
        console.log(`- ${pair.originCountry.name} -> ${pair.destinationCountry.name}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
