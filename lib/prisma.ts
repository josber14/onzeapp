import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { encryptExchangeSecret, decryptExchangeSecret } from "@/lib/exchange-creds-crypto";

const connectionString =
  process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No está definida DIRECT_URL ni DATABASE_URL.");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// apiKey/secretKey/passphrase de BinanceCredentials/BybitCredentials/OkxCredentials
// se cifran en reposo (ver lib/exchange-creds-crypto.ts). Este extension es el
// único punto donde se cifra/descifra, para no tener que tocar cada uno de los
// ~17 lugares del bot que leen/escriben estas tablas directo con prisma.
const CRED_MODELS = new Set(["BinanceCredentials", "BybitCredentials", "OkxCredentials", "PartnerAccount"]);
const CRED_FIELDS = ["apiKey", "secretKey", "passphrase"] as const;

function encryptDataObject(data: unknown) {
  if (!data || typeof data !== "object") return;
  const obj = data as Record<string, unknown>;
  for (const f of CRED_FIELDS) {
    if (typeof obj[f] === "string" && obj[f]) obj[f] = encryptExchangeSecret(obj[f] as string);
  }
}

function decryptResultObject(row: unknown) {
  if (!row || typeof row !== "object") return;
  const obj = row as Record<string, unknown>;
  for (const f of CRED_FIELDS) {
    if (typeof obj[f] === "string" && obj[f]) obj[f] = decryptExchangeSecret(obj[f] as string);
  }
}

function buildClient() {
  const base = new PrismaClient({ adapter, log: ["error", "warn"] });
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && CRED_MODELS.has(model)) {
            const a = args as Record<string, unknown>;
            if (operation === "create" || operation === "update") {
              encryptDataObject(a.data);
            } else if (operation === "upsert") {
              encryptDataObject(a.create);
              encryptDataObject(a.update);
            }
          }
          const result = await query(args);
          if (model && CRED_MODELS.has(model)) {
            if (Array.isArray(result)) result.forEach(decryptResultObject);
            else decryptResultObject(result);
          }
          return result;
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof buildClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}