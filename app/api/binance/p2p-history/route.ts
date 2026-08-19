import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BINANCE_BASE_URL = "https://api.binance.com";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function signQuery(query: string, secretKey: string) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

function formatOrder(o: any) {
  return {
    orderNumber: String(o.orderNumber || ""),
    tradeType: "SELL",
    asset: String(o.asset || "USDT"),
    fiat: "CLP",
    amount: Number(o.amount || 0),
    totalPrice: Number(o.totalPrice || 0),
    unitPrice: Number(o.unitPrice || 0),
    commission: Number(o.commission || 0),
    orderStatus: String(o.orderStatus || "COMPLETED"),
    payMethodName: String(o.payMethodName || ""),
    counterPartNickName: String(o.counterPartNickName || ""),
    createTime: Number(o.createTime || 0),
    createdAt: o.createTime ? new Date(Number(o.createTime)).toISOString() : new Date().toISOString(),
  };
}

async function fetchAllBinanceOrders(apiKey: string, secretKey: string, startTimestamp?: number) {
  const allOrders: any[] = [];
  let page = 1;

  while (page <= 50) {
    const params = new URLSearchParams();
    params.set("tradeType", "SELL");
    params.set("page", String(page));
    params.set("rows", "100");
    params.set("recvWindow", "5000");
    params.set("timestamp", String(Date.now()));
    if (startTimestamp) {
      params.set("startTimestamp", String(startTimestamp));
    }

    const query = params.toString();
    const signature = signQuery(query, secretKey);
    const url = `${BINANCE_BASE_URL}/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`;

    const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json?.msg || `Binance error HTTP ${res.status}`);
    }

    const items = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) break;

    // Bug real confirmado en vivo (ago 2026, cuenta de Hector): se pide
    // rows=100 pero Binance en la práctica entrega como máximo 50 por
    // página en este endpoint -- "menos de 100" era SIEMPRE cierto, así que
    // el loop se paraba después de la página 1 todas las veces, perdiendo
    // en silencio las páginas más viejas (confirmado pidiendo páginas 2, 3
    // y 4 a mano: tenían ventas reales de días anteriores). Se quitó ese
    // corte -- pero eso solo, sin nada más, hizo que cuentas con un cutoff
    // viejo (ej. tenant 1/ONZE, corte de más de un mes atrás) recorrieran
    // TODO el historial hasta una página vacía en CADA sincronización de
    // 15s, poniendo el dashboard notablemente lento (bug real confirmado en
    // vivo, ago 2026, cuenta propia de Josber). Las órdenes vienen más
    // nuevas primero -- en cuanto una página completa queda ANTES del
    // startTimestamp, todo lo que sigue también va a estar antes, así que
    // ahí sí se puede cortar sin perder nada.
    let pageHasAnyWithinCutoff = !startTimestamp;

    for (const item of items) {
      const createTime = Number(item.createTime || 0);
      if (startTimestamp && createTime < startTimestamp) continue;
      pageHasAnyWithinCutoff = true;

      if (
        String(item.fiat || "").toUpperCase() === "CLP" &&
        String(item.orderStatus || "").toUpperCase() === "COMPLETED"
      ) {
        allOrders.push(formatOrder(item));
      }
    }

    if (startTimestamp && !pageHasAnyWithinCutoff) break;
    page++;
  }

  return allOrders;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const label = req.nextUrl.searchParams.get("label") || "ONZE";

    // Leer cutoff post-reset para no re-importar órdenes anteriores
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { p2pResetCutoff: true },
    });
    const resetCutoff = settings?.p2pResetCutoff ? Number(settings.p2pResetCutoff) : undefined;

    // Bug real confirmado en vivo (ago 2026, cuenta propia de Josber/ONZE):
    // con el cutoff del reset (ej. 9 de julio) tal cual, CADA sincronización
    // de 15s tenía que recorrer TODO el historial desde esa fecha otra vez
    // -- en una cuenta con mucho volumen (1746+ órdenes) tardaba ~25s, más
    // que el propio intervalo de 15s, poniendo el dashboard visiblemente
    // lento. Mismo patrón ya usado en app/api/partner/sync/route.ts (AKI
    // Transfers, nunca tuvo este problema): en vez de recorrer desde el
    // cutoff original en cada sync, arrancar desde la orden más nueva que
    // YA está guardada en BinanceOrder -- 2h de colchón por seguridad. La
    // primera sincronización (caché vacía) sigue usando el cutoff completo.
    const OVERLAP_BUFFER_MS = 2 * 60 * 60 * 1000;
    const latestCached = await prisma.binanceOrder.aggregate({
      where: { tenantId },
      _max: { createTime: true },
    });
    const latestCachedMs = latestCached._max.createTime ? Number(latestCached._max.createTime) : null;
    const incrementalStart = latestCachedMs ? latestCachedMs - OVERLAP_BUFFER_MS : undefined;
    const startTimestamp = incrementalStart && resetCutoff
      ? Math.max(incrementalStart, resetCutoff)
      : incrementalStart ?? resetCutoff;

    let apiKey: string | null = null;
    let secretKey: string | null = null;

    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId, isActive: true, label },
      orderBy: { id: "asc" },
      select: { apiKey: true, secretKey: true, isActive: true },
    });

    if (creds?.apiKey && creds?.secretKey && creds?.isActive) {
      apiKey = creds.apiKey;
      secretKey = creds.secretKey;
    }

    if (!apiKey) {
      apiKey = process.env.BINANCE_API_KEY || process.env.BINANCE_KEY || null;
      secretKey = process.env.BINANCE_SECRET_KEY || process.env.BINANCE_SECRET || null;
    }

    if (!apiKey || !secretKey) {
      const orders = await prisma.binanceOrder.findMany({
        where: { tenantId, fiat: "CLP" },
        orderBy: { createTime: "desc" },
        take: 100,
      });

      return Response.json({
        ok: true,
        total: orders.length,
        source: "database",
        orders: orders.map((o) => ({
          orderNumber: o.orderNumber,
          tradeType: o.tradeType,
          asset: o.asset,
          fiat: o.fiat,
          amount: Number(o.amount),
          totalPrice: Number(o.totalPrice),
          unitPrice: Number(o.unitPrice),
          commission: Number(o.commission),
          orderStatus: o.orderStatus,
          payMethodName: o.payMethodName,
          counterPartNickName: o.counterPartNickName,
          createTime: Number(o.createTime),
          createdAt: o.createdAt.toISOString(),
        })),
      });
    }

    try {
      const allOrders = await fetchAllBinanceOrders(apiKey, secretKey, startTimestamp);

      for (const o of allOrders) {
        try {
          await prisma.binanceOrder.upsert({
            where: { orderNumber: o.orderNumber },
            update: { orderStatus: o.orderStatus, syncedAt: new Date() },
            create: {
              tenantId,
              orderNumber: o.orderNumber,
              tradeType: "SELL",
              asset: o.asset,
              fiat: "CLP",
              amount: o.amount,
              totalPrice: o.totalPrice,
              unitPrice: o.unitPrice,
              commission: o.commission,
              orderStatus: o.orderStatus,
              payMethodName: o.payMethodName,
              counterPartNickName: o.counterPartNickName,
              createTime: BigInt(o.createTime),
              createdAt: new Date(o.createTime),
            },
          });
        } catch (_) {}
      }

      return Response.json({
        ok: true,
        total: allOrders.length,
        source: "binance",
        orders: allOrders,
      });
    } catch (e) {
      console.warn("Binance live fetch failed, falling back to DB:", e);
    }

    const orders = await prisma.binanceOrder.findMany({
      where: { tenantId, fiat: "CLP" },
      orderBy: { createTime: "desc" },
      take: 100,
    });

    return Response.json({
      ok: true,
      total: orders.length,
      source: "database",
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        tradeType: o.tradeType,
        asset: o.asset,
        fiat: o.fiat,
        amount: Number(o.amount),
        totalPrice: Number(o.totalPrice),
        unitPrice: Number(o.unitPrice),
        commission: Number(o.commission),
        orderStatus: o.orderStatus,
        payMethodName: o.payMethodName,
        counterPartNickName: o.counterPartNickName,
        createTime: Number(o.createTime),
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("BINANCE_P2P_HISTORY_ERROR:", error?.stack || error?.message || error);
    return Response.json(
      {
        ok: false,
        error: error?.message || "Error desconocido consultando Binance",
        detail: error?.stack?.split("\n").slice(0,3).join(" | "),
      },
      { status: 500 }
    );
  }
}
