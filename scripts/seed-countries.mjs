import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Países usados hoy en el Sheet de tasas ("Crea tu tasa del día") y en el
// sistema de Operaciones. Reponen la tabla Country, vacía desde el incidente
// de reset de base de datos.
const COUNTRIES = [
  { code: "CL", name: "CHILE", currencyCode: "CLP", flagEmoji: "🇨🇱" },
  { code: "VE", name: "VENEZUELA", currencyCode: "VES", flagEmoji: "🇻🇪" },
  { code: "AR", name: "ARGENTINA", currencyCode: "ARS", flagEmoji: "🇦🇷" },
  { code: "US", name: "USA", currencyCode: "USD", flagEmoji: "🇺🇸" },
  { code: "ES", name: "ESPAÑA", currencyCode: "EUR", flagEmoji: "🇪🇸" },
  { code: "MX", name: "MEXICO", currencyCode: "MXN", flagEmoji: "🇲🇽" },
  { code: "BR", name: "BRASIL", currencyCode: "BRL", flagEmoji: "🇧🇷" },
  { code: "CO", name: "COLOMBIA", currencyCode: "COP", flagEmoji: "🇨🇴" },
  { code: "PE", name: "PERU", currencyCode: "PEN", flagEmoji: "🇵🇪" },
  { code: "UY", name: "URUGUAY", currencyCode: "UYU", flagEmoji: "🇺🇾" },
  { code: "EC", name: "ECUADOR", currencyCode: "USD", flagEmoji: "🇪🇨" },
];

for (const c of COUNTRIES) {
  const result = await prisma.country.upsert({
    where: { code: c.code },
    update: { name: c.name, currencyCode: c.currencyCode, flagEmoji: c.flagEmoji, active: true },
    create: c,
  });
  console.log(`  ${result.flagEmoji} ${result.name} (${result.code}) — id=${result.id}`);
}

const total = await prisma.country.count();
console.log(`\nTotal países en DB: ${total}`);

await prisma.$disconnect();
