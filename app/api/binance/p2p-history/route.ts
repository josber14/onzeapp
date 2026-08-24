import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Reescrito (ago 2026, pedido explícito del usuario): antes esta ruta hacía
// una llamada EN VIVO a Binance cada vez que alguien la pedía (botón
// "Sincronizar" o el timer de 15s del panel) -- dependía de que un
// navegador estuviera abierto, guardaba en una tabla (BinanceOrder) sin
// separar por cuenta (ONZE/ZINPLE mezclados) y podía fallar por límite de
// velocidad de Binance justo cuando se necesitaba el dato.
//
// Ahora lee directo de P2PBotOrder, que el propio ciclo del bot (en
// engine.ts, "5. Sync orders") ya llena y mantiene al día SOLO, sin
// depender de ningún navegador -- corrige de paso los dos bugs reales que
// tenía esa sincronización (no guardaba `label`, no refrescaba el estado
// de una orden después de crearla). Empieza "limpio": las órdenes viejas
// guardadas antes de ese arreglo (label=null) no tienen forma confiable de
// saber a qué cuenta pertenecían, así que quedan afuera a propósito -- no
// se usan para ningún cálculo nuevo.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const label = req.nextUrl.searchParams.get("label") || "ONZE";

    const rows = await prisma.p2PBotOrder.findMany({
      where: {
        tenantId,
        label,
        exchange: "binance",
        tradeType: "SELL",
        fiat: "CLP",
        status: "COMPLETED",
      },
      orderBy: { executedAt: "desc" },
      take: 500,
    });

    const orders = rows.map((o) => ({
      orderNumber: o.orderNumber,
      tradeType: o.tradeType,
      asset: o.asset,
      fiat: o.fiat,
      amount: Number(o.amount),
      totalPrice: Number(o.totalPrice),
      unitPrice: Number(o.unitPrice),
      commission: Number(o.commission || 0),
      orderStatus: o.status,
      payMethodName: "",
      counterPartNickName: o.counterparty || "",
      createTime: o.executedAt.getTime(),
      createdAt: o.executedAt.toISOString(),
    }));

    return Response.json({ ok: true, total: orders.length, source: "database", orders });
  } catch (error: any) {
    console.error("BINANCE_P2P_HISTORY_ERROR:", error?.stack || error?.message || error);
    return Response.json(
      { ok: false, error: error?.message || "Error desconocido consultando el historial" },
      { status: 500 }
    );
  }
}
