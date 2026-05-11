import crypto from "crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const BINANCE_BASE_URL = "https://api.binance.com";
const TENANT_ID = 1;

function signQuery(query, secretKey) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

async function fetchBinanceSellCLP() {
  const apiKey = process.env.BINANCE_API_KEY || process.env.BINANCE_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY || process.env.BINANCE_SECRET;

  if (!apiKey || !secretKey) {
    console.error("❌ Faltan credenciales Binance en .env.local");
    process.exit(1);
  }

  const params = new URLSearchParams();
  params.set("tradeType", "SELL");
  params.set("page", "1");
  params.set("rows", "100");
  params.set("recvWindow", "5000");
  params.set("timestamp", String(Date.now()));

  const query = params.toString();
  const signature = signQuery(query, secretKey);
  const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || `Binance error: ${res.status}`);

  const allOrders = Array.isArray(data?.data) ? data.data : [];
  return allOrders.filter(o => o.fiat === "CLP" && o.tradeType === "SELL");
}

async function syncOrders() {
  console.log("🔄 Sincronizando órdenes Binance...");
  const orders = await fetchBinanceSellCLP();
  console.log(`📦 ${orders.length} órdenes encontradas`);

  let nuevas = 0;
  for (const o of orders) {
    try {
      await prisma.binanceOrder.upsert({
        where: { orderNumber: o.orderNumber },
        update: { orderStatus: o.orderStatus, syncedAt: new Date() },
        create: {
          tenantId: TENANT_ID,
          orderNumber: o.orderNumber,
          tradeType: "SELL",
          asset: o.asset || "USDT",
          fiat: "CLP",
          amount: parseFloat(o.amount || 0),
          totalPrice: parseFloat(o.totalPrice || 0),
          unitPrice: parseFloat(o.unitPrice || 0),
          commission: parseFloat(o.commission || 0),
          orderStatus: o.orderStatus || "",
          createTime: BigInt(o.createTime || 0),
          createdAt: new Date(Number(o.createTime || 0)),
        },
      });
      nuevas++;
    } catch (e) {
      console.error(`❌ Error con orden ${o.orderNumber}:`, e.message);
    }
  }

  console.log(`✅ ${nuevas} órdenes sincronizadas en Neon`);
  await prisma.$disconnect();
}

syncOrders().catch(async e => {
  console.error("❌ Error:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
