import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Venta manual del socio — mismo modelo (PartnerSale) que las ventas
// sincronizadas de Binance, así que corre exactamente por la misma lógica
// (FIFO de capacity, estadísticas por día, ganancia) sin ningún camino
// especial. orderNumber con prefijo "manual_" para no chocar nunca con un
// número de orden real de Binance (siempre numéricos) y para poder
// identificarla al borrar.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clp = Number(body?.clp || 0);
  const sellPrice = Number(body?.sellPrice || 0);
  const commissionPct = Number(body?.commissionPct ?? 0);
  const executedAt = body?.executedAt ? new Date(body.executedAt) : new Date();

  if (!(clp > 0)) {
    return NextResponse.json({ ok: false, error: "Ingresa el CLP recibido" }, { status: 400 });
  }
  if (!(sellPrice > 0)) {
    return NextResponse.json({ ok: false, error: "Ingresa el precio de venta" }, { status: 400 });
  }
  if (!(commissionPct >= 0)) {
    return NextResponse.json({ ok: false, error: "Comisión inválida" }, { status: 400 });
  }
  if (isNaN(executedAt.getTime())) {
    return NextResponse.json({ ok: false, error: "Fecha inválida" }, { status: 400 });
  }

  const amount = clp / sellPrice; // USDT vendido
  const commission = (amount * commissionPct) / 100;
  const orderNumber = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await prisma.partnerSale.create({
    data: {
      tenantId: session.tenantId,
      label: LABEL,
      orderNumber,
      amount,
      totalPrice: clp,
      unitPrice: sellPrice,
      commission,
      fiat: "CLP",
      orderStatus: "COMPLETED",
      paymentMethod: "Manual",
      executedAt,
    },
  });

  return NextResponse.json({ ok: true, orderNumber });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const orderNumber = searchParams.get("orderNumber") || "";
  // Solo se puede borrar por este endpoint una venta manual — nunca una
  // sincronizada de verdad desde Binance (esas se corrigen resincronizando).
  if (!orderNumber.startsWith("manual_")) {
    return NextResponse.json({ ok: false, error: "Solo se pueden borrar ventas manuales" }, { status: 400 });
  }
  await prisma.partnerSale.deleteMany({
    where: { tenantId: session.tenantId, label: LABEL, orderNumber },
  });
  return NextResponse.json({ ok: true });
}
