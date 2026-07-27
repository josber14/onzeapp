import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { randomBytes, createCipheriv } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";

function getKey() {
  const raw = process.env.EXCHANGE_CREDS_ENC_KEY;
  if (!raw) throw new Error("EXCHANGE_CREDS_ENC_KEY no definido");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("EXCHANGE_CREDS_ENC_KEY debe ser 32 bytes en base64");
  return key;
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function migrateModel(name, delegate, fields) {
  const rows = await delegate.findMany();
  let migrated = 0;
  for (const row of rows) {
    const data = {};
    for (const f of fields) {
      const v = row[f];
      if (typeof v === "string" && v && !v.startsWith(PREFIX)) {
        data[f] = encrypt(v);
      }
    }
    if (Object.keys(data).length > 0) {
      await delegate.update({ where: { id: row.id }, data });
      migrated++;
    }
  }
  console.log(`${name}: ${rows.length} filas totales, ${migrated} migradas a cifrado`);
}

async function main() {
  await migrateModel("BinanceCredentials", prisma.binanceCredentials, ["apiKey", "secretKey"]);
  await migrateModel("BybitCredentials", prisma.bybitCredentials, ["apiKey", "secretKey"]);
  await migrateModel("OkxCredentials", prisma.okxCredentials, ["apiKey", "secretKey", "passphrase"]);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
