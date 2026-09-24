import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Ventas marcadas como "capital propio" desde el aviso "Ventas sin
// compra/capacity detectadas" -- ver AGENTS.md y el comentario en
// prisma/schema.prisma sobre P2PCapitalMarkedSale. Antes esto vivía SOLO en
// localStorage (un total agregado, sin registrar qué órdenes puntuales se
// habían marcado) -- ni se sincronizaba entre dispositivos, ni excluía esas
// ventas del reparto real de calculateP2PCapacityStats(), así que volvían a
// "reaparecer" como ganancia nueva en cuanto se creaba un capacity nuevo.
export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const items = await prisma.p2PCapitalMarkedSale.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { executedAt: "asc" },
  });

  return NextResponse.json({
    ok: true,
    items: items.map((it) => ({
      orderNumber: it.id,
      exchange: it.exchange,
      amount: Number(it.amount),
      totalPrice: Number(it.totalPrice),
      commission: Number(it.commission),
      executedAt: it.executedAt.toISOString(),
    })),
  });
}

// Body: { items: [{ orderNumber, exchange, amount, totalPrice, commission, executedAt }, ...] }
// Bulk -- el botón marca TODAS las ventas sin asignar del momento de una vez.
//
// Bug real confirmado en vivo (sep 2026): con una cuenta de alto volumen
// (661 ventas sin asignar de una), el loop de abajo hacía 2 consultas
// SECUENCIALES por cada venta (find + upsert) -- 1.300+ idas y vueltas a la
// base en una sola llamada, que superaba el tiempo límite de la función
// mucho antes de terminar. El usuario veía que el botón solo "marcaba" las
// primeras ~10 y tenía que apretarlo una y otra vez. Arreglo: una sola
// consulta bulk (createMany + skipDuplicates) en vez de cientos de idas y
// vueltas -- mismo resultado (una fila nueva por orden, nunca pisa una ya
// existente, sea de este tenant o de otro), pero en una sola operación.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Falta items" }, { status: 400 });
  }

  const rows = items
    .map((item: any) => ({ orderNumber: String(item?.orderNumber || ""), item }))
    .filter((r: any) => r.orderNumber)
    .map(({ orderNumber, item }: any) => ({
      id: orderNumber,
      tenantId,
      exchange: String(item.exchange || "binance"),
      amount: Number(item.amount || 0),
      totalPrice: Number(item.totalPrice || 0),
      commission: Number(item.commission || 0),
      executedAt: item.executedAt ? new Date(item.executedAt) : new Date(),
    }));

  const result = await prisma.p2PCapitalMarkedSale.createMany({ data: rows, skipDuplicates: true });

  return NextResponse.json({ ok: true, created: result.count, requested: rows.length });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const orderNumber = searchParams.get("orderNumber");
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber" }, { status: 400 });
  }

  await prisma.p2PCapitalMarkedSale.deleteMany({ where: { id: orderNumber, tenantId: session.tenantId } });

  return NextResponse.json({ ok: true });
}
