import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getBotOrders } from "@/lib/p2p-bot/engine";
import { BybitP2PClient, bybitOrderGroup, bybitOrderStatusLabel } from "@/lib/p2p-bot/bybit-adapter";
import { prisma } from "@/lib/prisma";

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
    const exchange = searchParams.get("exchange") || undefined;

    // Fetch from local DB first
    const localOrders = await getBotOrders(session.tenantId, limit, exchange);

    // For Bybit, also try to fetch live orders from API
    let bybitOrders: any[] = [];
    if (!exchange || exchange === "bybit") {
      try {
        const creds = await prisma.bybitCredentials.findUnique({
          where: { tenantId: session.tenantId, isActive: true },
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

    return Response.json({ ok: true, orders: deduped });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { action, orderNumber, exchange, message } = body;

    if (!action || !orderNumber) {
      return Response.json({ ok: false, error: "action y orderNumber requeridos" }, { status: 400 });
    }

    if (exchange === "bybit") {
      const creds = await prisma.bybitCredentials.findUnique({
        where: { tenantId: session.tenantId, isActive: true },
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
