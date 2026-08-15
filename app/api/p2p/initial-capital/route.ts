import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function capitalRecordId(tenantId: number) {
  return `_p2p_initial_capital_${tenantId}`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const record = await prisma.p2PCapacity.findUnique({
      where: { id: capitalRecordId(session.tenantId) },
    });

    return Response.json({
      ok: true,
      // Capital inicial -- FIJO, solo cambia si el usuario lo edita a mano
      // (botón 💰 Capital). Nunca lo toca el rollover automático.
      value: Number(record?.capacityClp || 0),
      // Ganancia acumulada de meses YA TERMINADOS -- reusa el campo
      // usdtAmount de este registro especial (nunca se usa para otra cosa
      // acá). Pedido explícito del usuario (ago 2026): "Capital P2P" =
      // inicial + acumulada + ganancia de ESTE MES (en vivo). Al pasar de
      // mes, la ganancia de ese mes se suma acá (no al inicial) y "este
      // mes" vuelve a 0 sin que el total baje.
      accumulatedProfit: Number(record?.usdtAmount || 0),
      // Reusa el campo "date" para guardar hasta qué mes (YYYY-MM) ya
      // quedó sumado a accumulatedProfit -- lo usa el rollover automático
      // en el cliente (p2pMonthlyCapitalRollover) para sumar cada mes
      // terminado UNA sola vez. null = tenant viejo que nunca pasó por
      // esto todavía.
      throughMonth: record?.date ? record.date.slice(0, 7) : null,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error obteniendo capital inicial" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { value, throughMonth, accumulatedProfit } = body ?? {};

    const id = capitalRecordId(session.tenantId);
    const chileMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
    const dateValue = (typeof throughMonth === "string" && /^\d{4}-\d{2}$/.test(throughMonth))
      ? `${throughMonth}-01`
      : `${chileMonth}-01`;

    // Dos llamadas distintas usan esta misma ruta:
    // 1) Ajuste MANUAL (botón 💰 Capital, siempre manda "value"): pisa el
    //    capital inicial y RESETEA la ganancia acumulada a 0 -- se asume
    //    que el número que el usuario escribió ya refleja todo lo ganado
    //    hasta ahora, así que no hay que seguir sumando lo viejo encima.
    // 2) Rollover automático de fin de mes (manda "accumulatedProfit" y
    //    "throughMonth", SIN "value"): solo suma a la ganancia acumulada,
    //    nunca toca el capital inicial.
    const isManualEdit = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
    const updateData: { capacityClp?: number; usdtAmount?: number; date: string } = { date: dateValue };
    if (isManualEdit) {
      updateData.capacityClp = Number(value || 0);
      updateData.usdtAmount = 0;
    } else if (typeof accumulatedProfit === "number") {
      updateData.usdtAmount = accumulatedProfit;
    }

    const record = await prisma.p2PCapacity.upsert({
      where: { id },
      update: updateData,
      create: {
        id,
        tenantId: session.tenantId,
        capacityClp: isManualEdit ? Number(value || 0) : 0,
        buyPrice: 0,
        usdtAmount: typeof accumulatedProfit === "number" ? accumulatedProfit : 0,
        provider: "_initial_capital",
        status: "_capital",
        date: dateValue,
      },
    });

    return Response.json({
      ok: true,
      value: Number(record.capacityClp || 0),
      accumulatedProfit: Number(record.usdtAmount || 0),
      throughMonth: record.date.slice(0, 7),
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error guardando capital inicial" },
      { status: 500 }
    );
  }
}
