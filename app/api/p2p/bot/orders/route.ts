import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getBotOrders } from "@/lib/p2p-bot/engine";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "@/lib/p2p-bot/bybit-adapter";
import { fetchLiveOrders } from "@/lib/p2p-bot/live";
import { prisma } from "@/lib/prisma";
import { consumeReleaseAuthToken } from "@/lib/security-pin";

async function enrichOrdersWithChatData(orders: any[], tenantId: number, exchange: string) {
  if (!orders.length) return;
  const orderNumbers = orders.map(o => o.orderNumber);
  const chatStates = await prisma.p2PChatState.findMany({
    where: { tenantId, exchange, orderNumber: { in: orderNumbers } },
    select: { orderNumber: true, lastClientMsgAt: true },
  });
  const chatMap = new Map(chatStates.map(c => [c.orderNumber, c.lastClientMsgAt]));
  for (const o of orders) {
    o.lastClientMsgAt = chatMap.get(o.orderNumber)?.toISOString() || null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || 50);
    const exchange = (searchParams.get("exchange") || "binance") as "binance" | "bybit" | "okx";
    const label = searchParams.get("label") || "ONZE";
    const live = searchParams.get("live") === "true";

    if (live) {
      try {
        const result = await fetchLiveOrders(exchange, session.tenantId, limit, label);
        if (result.orders.length > 0) {
          await enrichOrdersWithChatData(result.orders, session.tenantId, exchange);
          return Response.json({ ok: true, orders: result.orders, live: true });
        }
      } catch (e: any) {
        // Live API failed, fall through to DB
      }
      // Fallback: return DB orders
      const localOrders = await getBotOrders(session.tenantId, limit, exchange, label);
      await enrichOrdersWithChatData(localOrders, session.tenantId, exchange);
      return Response.json({ ok: true, orders: localOrders, live: false });
    }

    // Fetch from local DB first
    const localOrders = await getBotOrders(session.tenantId, limit, exchange, label);

    // For Bybit, also try to fetch live orders from API
    let bybitOrders: any[] = [];
    if (!exchange || exchange === "bybit") {
      try {
        const creds = await prisma.bybitCredentials.findFirst({
          where: { tenantId: session.tenantId, label, isActive: true },
          orderBy: { id: "asc" },
        });
        if (creds) {
          const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
          const res = await client.getOrders({ page: 1, size: 30 });
          const items = res?.result?.items || [];
          bybitOrders = items.map((o: any) => {
            const status = bybitOrderStatusLabel(Number(o.status));
            const group = bybitOrderGroup(Number(o.status));
            return {
              id: o.id,
              orderNumber: o.id,
              exchange: "bybit",
              tradeType: o.side === 0 ? "BUY" : "SELL",
              asset: o.tokenId || "USDT",
              fiat: o.currencyId || "CLP",
              amount: Number(o.amount) || 0,
              totalPrice: Number(o.amount) * Number(o.price) || 0,
              unitPrice: Number(o.price) || 0,
              status,
              group,
              counterparty: o.targetNickName || "",
              createdAt: o.createDate ? new Date(Number(o.createDate)).toISOString() : new Date().toISOString(),
            };
          });

          // Sync to local DB
          for (const o of items) {
            const existing = await prisma.p2PBotOrder.findFirst({
              where: { tenantId: session.tenantId, orderNumber: o.id, exchange: "bybit" },
            });
            if (!existing) {
              await prisma.p2PBotOrder.create({
                data: {
                  tenantId: session.tenantId,
                  exchange: "bybit",
                  orderNumber: o.id,
                  tradeType: o.side === 0 ? "BUY" : "SELL",
                  asset: o.tokenId || "USDT",
                  fiat: o.currencyId || "CLP",
                  amount: Number(o.amount) || 0,
                  totalPrice: Number(o.amount) * Number(o.price) || 0,
                  unitPrice: Number(o.price) || 0,
                  status: bybitOrderStatusLabel(Number(o.status)),
                  counterparty: o.targetNickName || "",
                  executedAt: new Date(Number(o.createDate)),
                },
              });
            }
          }
        }
      } catch (e) {
        // Silent fail - fallback to local orders
      }
    }

    // Merge: show live Bybit orders + local orders, deduplicated
    const merged = [...bybitOrders, ...localOrders];
    const seen = new Set<string>();
    const deduped = merged.filter(o => {
      const key = `${o.exchange}-${o.orderNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await enrichOrdersWithChatData(deduped, session.tenantId, exchange);

    return Response.json({ ok: true, orders: deduped });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, orderNumber, exchange, message } = body;
    const label = body.label || req.nextUrl.searchParams.get("label") || "ONZE";

    if (!action || !orderNumber) {
      return Response.json({ ok: false, error: "action y orderNumber requeridos" }, { status: 400 });
    }

    // Get tenantId from session, or from DB for verify action (mobile support)
    let tenantId: number | null = null;
    const session = await getSession();
    if (session?.tenantId) {
      tenantId = session.tenantId;
    } else if (action === "verify") {
      const firstCfg = await prisma.p2PBotExchangeConfig.findFirst({ where: { exchange: "binance" } });
      tenantId = firstCfg?.tenantId || null;
    }
    if (!tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    // Liberar una orden mueve USDT real de forma irreversible — exige el
    // token de un solo uso emitido recién al validar el PIN o la huella
    // (ver lib/security-pin.ts). Sin token válido, no se libera nada.
    if (action === "release") {
      const token = String(body.token || "");
      const authorized = await consumeReleaseAuthToken(tenantId, orderNumber, token);
      if (!authorized) {
        return Response.json({ ok: false, error: "Autorización inválida o expirada. Verifica tu clave o huella de nuevo." }, { status: 401 });
      }
    }

    if (exchange === "binance") {

      const creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId, isActive: true },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Binance" }, { status: 400 });
      }

      if (action === "verify") {
        const { BinanceP2PClient } = await import("@/lib/p2p-bot/binance-adapter");
        const { handleVerified, normalizeOrder } = await import("@/lib/p2p-bot/chat-agent");
        const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
        const cs = await prisma.p2PChatState.upsert({
          where: { tenantId_exchange_orderNumber: { tenantId, exchange: "binance", orderNumber } },
          update: { verifiedAt: new Date(), state: "awaiting_verification" },
          create: { tenantId, exchange: "binance", orderNumber, state: "awaiting_verification", verifiedAt: new Date() },
        });
        try {
          await client.verifyOrder(orderNumber);
        } catch (e: any) {
          console.warn("[Verify] verifyOrder error (ignored):", e.message);
        }
        // Send welcome message only if chat bot is enabled
        const exchCfg = await prisma.p2PBotExchangeConfig.findFirst({ where: { tenantId, exchange: "binance" } });
        if (exchCfg?.chatBotEnabled && !cs.lastBotMsgAt) {
          try {
            const [sellRes, buyRes] = await Promise.all([
              client.getOrders({ page: 1, rows: 50, tradeType: "SELL" }),
              client.getOrders({ page: 1, rows: 50, tradeType: "BUY" }),
            ]);
            const allOrders = [...(sellRes?.data ?? []), ...(buyRes?.data ?? [])];
            const rawOrder = allOrders.find((o: any) => (o.orderNumber ?? o.orderNo ?? o.id) === orderNumber);
            if (rawOrder) {
              const order = normalizeOrder(rawOrder, "binance");
              await handleVerified(tenantId, "binance", client, cs, order, []);
            }
          } catch (e: any) {
            console.warn("[Verify] sendWelcome error:", e.message);
          }
        }
        return Response.json({ ok: true, action, result: "Comprador verificado — datos bancarios visibles" });
      }

      if (action === "chat") {
        if (!message) {
          return Response.json({ ok: false, error: "Mensaje requerido" }, { status: 400 });
        }
        const { BinanceP2PClient } = await import("@/lib/p2p-bot/binance-adapter");
        const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
        const wsRes = await client.sendChatMessageWS(orderNumber, message);
        if (wsRes.ok) {
          return Response.json({ ok: true, action, result: "Mensaje enviado" });
        }
        return Response.json({ ok: false, error: wsRes.error || "Error al enviar el mensaje" }, { status: 500 });
      }

      if (action === "release") {
        // Credenciales SIEMPRE por label — la contraseña de fondos se guarda
        // por label (BinanceCredentials.fundPasswordEnc) y debe corresponder
        // EXACTAMENTE a la cuenta cuyas apiKey/secretKey se usan para llamar
        // a Binance, o el releaseCoin se firmaría con una cuenta y la
        // contraseña de fondos sería de otra.
        const releaseCreds = await prisma.binanceCredentials.findUnique({
          where: { tenantId_label: { tenantId, label } },
        });
        if (!releaseCreds) {
          return Response.json({ ok: false, error: `Sin credenciales Binance para ${label}` }, { status: 400 });
        }
        const { BinanceP2PClient } = await import("@/lib/p2p-bot/binance-adapter");
        const { getBinanceFundPassword } = await import("@/lib/binance-fund-password");
        const fundPassword = await getBinanceFundPassword(tenantId, label);
        if (!fundPassword) {
          return Response.json({ ok: false, error: `No has configurado tu contraseña de fondos de Binance para ${label} todavía.` }, { status: 400 });
        }
        const client = new BinanceP2PClient(releaseCreds.apiKey, releaseCreds.secretKey);
        try {
          await client.releaseAssets(orderNumber, fundPassword);
          return Response.json({ ok: true, action, result: "Activos liberados" });
        } catch (e: any) {
          return Response.json({ ok: false, error: e.message || "No se pudo liberar la orden" }, { status: 502 });
        }
      }

      return Response.json({ ok: false, error: `Acción no soportada para Binance: ${action}` }, { status: 400 });
    }

    if (exchange === "bybit") {
      const creds = await prisma.bybitCredentials.findFirst({
        where: { tenantId: tenantId!, isActive: true, label },
        orderBy: { id: "asc" },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Bybit" }, { status: 400 });
      }
      const client = new BybitP2PClient(creds.apiKey, creds.secretKey);

      switch (action) {
        case "accept":
          await client.markAsPaid(orderNumber, body.paymentType || "", body.paymentId || "");
          return Response.json({ ok: true, action, result: "Orden marcada como pagada" });

        case "release":
          await client.releaseAssets(orderNumber);
          return Response.json({ ok: true, action, result: "Activos liberados" });

        case "chat":
          if (!message) {
            return Response.json({ ok: false, error: "Mensaje requerido" }, { status: 400 });
          }
          await client.sendChatMessage(orderNumber, message);
          return Response.json({ ok: true, action, result: "Mensaje enviado" });

        default:
          return Response.json({ ok: false, error: `Acción desconocida: ${action}` }, { status: 400 });
      }
    }

    return Response.json({ ok: false, error: `Exchange ${exchange} no soportado para acciones en vivo` });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
