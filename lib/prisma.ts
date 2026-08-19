import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { encryptExchangeSecret, decryptExchangeSecret } from "@/lib/exchange-creds-crypto";

const connectionString =
  process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No está definida DIRECT_URL ni DATABASE_URL.");
}

// Neon corta las conexiones que llevan un rato sin usarse. Sin estas
// opciones, node-postgres a veces entrega del pool una conexión que ya está
// muerta del lado de Neon y la consulta se queda esperando una respuesta que
// nunca llega -- bug real confirmado en vivo (ago 2026): el login se quedaba
// pegado en "Verificando..." para siempre en la instancia de dev con más
// tiempo corriendo. keepAlive detecta conexiones muertas más rápido,
// idleTimeoutMillis recicla las que llevan mucho tiempo sin usarse antes de
// que Neon las corte, y query_timeout asegura que si de todos modos cae en
// una conexión mala, la consulta falle en 20s en vez de colgarse para
// siempre (para que la UI muestre un error en vez de girar sin parar).
const pool = new Pool({
  connectionString,
  keepAlive: true,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  query_timeout: 20_000,
});
pool.on("error", (err) => {
  console.error("Postgres pool error (conexión inactiva):", err);
});
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