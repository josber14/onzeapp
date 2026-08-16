import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pedido explícito del usuario (ago 2026, tenant de Hector): trackear cuánto
// ha entrado HOY por un banco específico (Banco Estado, límite 5.000.000
// CLP/día impuesto por el banco, no por Binance), para no pasarse. Se
// reinicia solo al cambiar el día calendario en hora de Chile.
const BANK_DAILY_LIMIT_CLP: Record<string, number> = {
  estado: 5_000_000,
};

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

// Calcula la medianoche de HOY en hora de Chile, como timestamp UTC en ms --
// sin librerías externas. Se apoya en que Date.UTC con los mismos dígitos de
// reloj que muestra Santiago, menos el instante real, da el offset horario
// de Santiago en ese momento (maneja el cambio de horario de verano solo).
function santiagoStartOfDayMs(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(now)
    .reduce((acc: Record<string, string>, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const pseudoUtcNow = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offsetMs = pseudoUtcNow - now.getTime();
  const pseudoUtcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0);
  return pseudoUtcMidnight - offsetMs;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const tenantId = session.tenantId;

    const { searchParams } = new URL(req.url);
    const label = searchParams.get("label") || "ONZE";
    const exchange = searchParams.get("exchange") || "binance";
    const bank = (searchParams.get("bank") || "estado").toLowerCase();
    const limit = BANK_DAILY_LIMIT_CLP[bank] ?? 0;

    if (exchange !== "binance") {
      return Response.json({ ok: false, error: "Solo disponible para Binance por ahora" }, { status: 400 });
    }

    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId, isActive: true, label },
      orderBy: { id: "asc" },
    });
    if (!creds) {
      return Response.json({ ok: false, error: "No hay credenciales de Binance configuradas" }, { status: 404 });
    }

    const now = new Date();
    const startMs = santiagoStartOfDayMs(now);
    const client = new BinanceP2PClient(creds.apiKey, creds.secretKey);

    const allOrders: any[] = [];
    for (let page = 1; page <= 5; page++) {
      const pageRes = await client.getOrders({ page, rows: 100, startTimestamp: startMs, endTimestamp: now.getTime() });
      const pageData = pageRes?.data || [];
      if (pageData.length === 0) break;
      allOrders.push(...pageData);
    }

    const todayOrders = allOrders.filter((o: any) => o.orderStatus === "COMPLETED" && o.fiat === "CLP");

    const exclusions = await prisma.p2PBankQuotaExclusion.findMany({
      where: { tenantId, exchange, orderNumber: { in: todayOrders.map((o: any) => String(o.orderNumber)) } },
    });
    const excludedSet = new Set(exclusions.map((e) => e.orderNumber));

    const chatStates = await prisma.p2PChatState.findMany({
      where: { tenantId, exchange, orderNumber: { in: todayOrders.map((o: any) => String(o.orderNumber)) } },
      select: { orderNumber: true, chosenBank: true, realName: true, counterparty: true },
    });
    const chatByOrder = new Map(chatStates.map((c) => [c.orderNumber, c]));

    const bankOrders = todayOrders
      .filter((o: any) => {
        const cs = chatByOrder.get(String(o.orderNumber));
        return cs?.chosenBank && new RegExp(bank, "i").test(String(cs.chosenBank));
      })
      .map((o: any) => {
        const cs = chatByOrder.get(String(o.orderNumber));
        return {
          orderNumber: String(o.orderNumber),
          amountUsdt: Number(o.amount) || 0,
          amountClp: Math.round(Number(o.totalPrice) || 0),
          time: Number(o.createTime) || null,
          buyerName: cs?.realName || cs?.counterparty || null,
          excluded: excludedSet.has(String(o.orderNumber)),
        };
      })
      .sort((a, b) => (b.time || 0) - (a.time || 0));

    const total = bankOrders.filter((o) => !o.excluded).reduce((sum, o) => sum + o.amountClp, 0);

    return Response.json({ ok: true, total, limit, bank, orders: bankOrders });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message || "Error obteniendo cupo de banco" }, { status: 500 });
  }
}

// Marca/desmarca una orden como excluida del cupo -- pedido explícito del
// usuario: cuando alguien elige "Banco Estado" en el chat pero termina
// transfiriendo a otro banco, hay que poder sacarla del conteo sin borrar la
// orden ni la venta real.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const tenantId = session.tenantId;

    const body = await req.json().catch(() => ({}));
    const exchange = body.exchange || "binance";
    const orderNumber = String(body.orderNumber || "");
    if (!orderNumber) {
      return Response.json({ ok: false, error: "Falta orderNumber" }, { status: 400 });
    }

    const existing = await prisma.p2PBankQuotaExclusion.findUnique({
      where: { tenantId_exchange_orderNumber: { tenantId, exchange, orderNumber } },
    });

    if (existing) {
      await prisma.p2PBankQuotaExclusion.delete({ where: { id: existing.id } });
      return Response.json({ ok: true, excluded: false });
    }

    await prisma.p2PBankQuotaExclusion.create({
      data: { tenantId, exchange, orderNumber },
    });
    return Response.json({ ok: true, excluded: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message || "Error actualizando exclusión" }, { status: 500 });
  }
}
