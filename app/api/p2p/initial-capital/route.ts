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
      // Punto de corte de retiros (ago 2026, "empezar de cero"): reusa
      // finishedAt de este registro especial (nunca se usa para otra cosa
      // acá). Retiros de ANTES de esta fecha ya quedaron reflejados en el
      // capital inicial de arriba (fue justamente lo que lo bajó) -- seguir
      // restándolos también en vivo sería descontarlos dos veces. Solo los
      // retiros de esta fecha en adelante restan del Capital P2P mostrado.
      // null = nunca se reseteó, se siguen restando TODOS (comportamiento de
      // siempre, sin romper nada para tenants que nunca usaron esto).
      withdrawalsBaselineAt: record?.finishedAt ? record.finishedAt.toISOString() : null,
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
    const { value, throughMonth, accumulatedProfit, reset } = body ?? {};

    const id = capitalRecordId(session.tenantId);
    const chileMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
    const dateValue = (typeof throughMonth === "string" && /^\d{4}-\d{2}$/.test(throughMonth))
      ? `${throughMonth}-01`
      : `${chileMonth}-01`;

    // Dos llamadas distintas usan esta misma ruta:
    // 1) Ajuste MANUAL (botón 💰 Capital, siempre manda "value"): pisa
    //    ÚNICAMENTE el capital inicial. NO toca la ganancia acumulada --
    //    son dos números independientes (capital inicial = aporte fijo
    //    original; acumulado = ganancia de meses ya terminados, la va
    //    sumando sola el rollover). Bug real confirmado en vivo (ago 2026,
    //    tenant de Hector): esto SÍ reseteaba usdtAmount a 0 en cada edición
    //    manual del inicial, borrando de un plumazo el acumulado migrado y
    //    haciendo caer el total de Capital P2P a un número absurdamente
    //    bajo. Si el usuario quiere ajustar también el acumulado, debe
    //    hacerlo aparte (no hay UI para eso todavía -- se edita a mano en DB
    //    caso por caso, como se hizo para Hector).
    // 2) Rollover automático de fin de mes (manda "accumulatedProfit" y
    //    "throughMonth", SIN "value"): solo suma a la ganancia acumulada,
    //    nunca toca el capital inicial.
    const isManualEdit = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
    const updateData: { capacityClp?: number; usdtAmount?: number; date: string; finishedAt?: Date } = { date: dateValue };
    if (reset === true) {
      // 3) Reseteo explícito ("empezar de cero", ago 2026, pedido del
      //    usuario tras un nuevo mes): fija el nuevo inicial, borra el
      //    acumulado, y mueve a HOY el punto de corte de retiros -- las tres
      //    cosas atómicas, solo cuando se pide este reseteo a propósito
      //    (nunca se dispara por una edición normal del inicial ni por el
      //    rollover automático de fin de mes).
      updateData.capacityClp = Number(value || 0);
      updateData.usdtAmount = 0;
      updateData.finishedAt = new Date();
    } else if (isManualEdit) {
      updateData.capacityClp = Number(value || 0);
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
        finishedAt: reset === true ? new Date() : null,
      },
    });

    return Response.json({
      ok: true,
      value: Number(record.capacityClp || 0),
      accumulatedProfit: Number(record.usdtAmount || 0),
      throughMonth: record.date.slice(0, 7),
      withdrawalsBaselineAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error guardando capital inicial" },
      { status: 500 }
    );
  }
}
