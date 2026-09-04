import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";
import { BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Pedido explícito del usuario (sep 2026): ver el nombre real del comprador
// (el mismo que Binance/Bybit ya muestran en su propia app, "Nombre del
// comprador") desde el panel web, para validar el pago sin depender del
// teléfono. El panel ya llamaba a esta ruta desde antes (ver
// public/onze-panel.html, botPanelOpenChat) pero nunca existió -- el fetch
// fallaba en silencio (catch vacío) y nadie lo notó hasta ahora.
//
// Binance: getUserOrderDetail trae `buyerName` (el nombre real completo)
// desde el inicio de la orden -- confirmado en vivo (sep 2026) contra una
// orden real todavía sin pagar, no hace falta esperar a que el comprador
// marque "pagado" como se asumía en el código viejo del panel.
// Bybit: mismo campo (`buyerRealName`) que ya usa chat-agent.ts para el
// saludo por nombre -- documentación oficial de Bybit.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const orderNo = searchParams.get("orderNo");
    const exchange = searchParams.get("exchange") || "binance";
    const label = searchParams.get("label") || "ONZE";
    if (!orderNo) {
      return Response.json({ ok: false, error: "orderNo requerido" }, { status: 400 });
    }

    if (exchange === "binance") {
      const creds = await prisma.binanceCredentials.findFirst({
        where: { tenantId: session.tenantId, label, isActive: true },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Binance" }, { status: 400 });
      }
      const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);
      const detail = await client.getUserOrderDetail(orderNo);
      const name = detail?.data?.buyerName || null;
      return Response.json({ ok: true, name });
    }

    if (exchange === "bybit") {
      const creds = await prisma.bybitCredentials.findFirst({
        where: { tenantId: session.tenantId, label, isActive: true },
        orderBy: { id: "asc" },
      });
      if (!creds) {
        return Response.json({ ok: false, error: "Sin credenciales Bybit" }, { status: 400 });
      }
      const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
      const detail = await client.getOrderDetail(orderNo);
      const name = detail?.result?.buyerRealName || null;
      return Response.json({ ok: true, name });
    }

    return Response.json({ ok: false, error: `Exchange ${exchange} no soportado` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
