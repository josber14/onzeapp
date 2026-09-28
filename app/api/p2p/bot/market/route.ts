import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { fetchLiveMarket } from "@/lib/p2p-bot/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Recreada (sep 2026) -- esta ruta se había borrado por completo junto con
// el Oráculo de Mercado (que la usaba para un historial guardado en
// P2PBotMarketSnapshot, escribiendo sin parar en cada ciclo del bot). Pero
// el selector "Elegir" comerciante en la config de cada anuncio (Excluir
// comerciantes / Comerciantes con los que puedo igualar precio) TAMBIÉN le
// pegaba a esta misma ruta para traer la lista de comerciantes EN VIVO --
// quedó rota (404 -> HTML en vez de JSON) hasta este arreglo. Solo se
// restauró la parte "en vivo" (fetchLiveMarket, sin tocar ninguna base de
// datos), que solo corre cuando alguien abre ese selector puntual -- no
// reintroduce el gasto que se eliminó (nada corre solo en el ciclo del bot).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exchange = (searchParams.get("exchange") || "bybit") as "binance" | "bybit" | "okx";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const label = searchParams.get("label") || "ONZE";

    const market = await fetchLiveMarket(exchange, session.tenantId, "1", label);
    return Response.json({
      ok: true,
      data: {
        cycleAt: market.cycleAt,
        totalCompetitors: market.totalCompetitors,
        ranked: market.competitors.slice(0, limit),
      },
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
