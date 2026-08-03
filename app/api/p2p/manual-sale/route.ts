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

// Ventas manuales (Bybit/OKX sin API conectada, o correcciones manuales de
// Binance) -- antes solo vivían en localStorage del panel, ver comentario en
// prisma/schema.prisma sobre P2PManualSale. Este endpoint las persiste en
// Neon para que sobrevivan a un cambio de navegador/dispositivo, igual que
// ya se hizo con /api/p2p/capacity.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const { searchParams } = new URL(req.url);
  const exchange = searchParams.get("exchange");

  const items = await prisma.p2PManualSale.findMany({
    where: { tenantId, ...(exchange ? { exchange } : {}) },
    orderBy: { executedAt: "desc" },
  });

  const orders = items.map((it: any) => ({
    orderNumber: it.id,
    tradeType: "SELL",
    asset: "USDT",
    fiat: "CLP",
    amount: Number(it.amount),
    totalPrice: Number(it.totalPrice),
    unitPrice: Number(it.unitPrice),
    commission: Number(it.commission),
    orderStatus: "COMPLETED",
    payMethodName: "Manual",
    counterPartNickName: "Manual",
    createTime: it.executedAt.getTime(),
    createdAt: it.executedAt.toISOString(),
    _manual: true,
    exchange: it.exchange,
  }));

  return NextResponse.json({ ok: true, orders });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json();
  const item = body?.item;
  if (!item?.orderNumber || !item?.exchange) {
    return NextResponse.json({ ok: false, error: "Falta orderNumber o exchange" }, { status: 400 });
  }

  const existing = await prisma.p2PManualSale.findUnique({ where: { id: String(item.orderNumber) } });
  if (existing && existing.tenantId !== tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const data = {
    tenantId,
    exchange: String(item.exchange),
    amount: Number(item.amount || 0),
    totalPrice: Number(item.totalPrice || 0),
    unitPrice: Number(item.unitPrice || 0),
    commission: Number(item.commission || 0),
    executedAt: item.createdAt ? new Date(item.createdAt) : new Date(),
  };

  await prisma.p2PManualSale.upsert({
    where: { id: String(item.orderNumber) },
    update: data,
    create: { id: String(item.orderNumber), ...data },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }

  await prisma.p2PManualSale.deleteMany({ where: { id, tenantId } });

  return NextResponse.json({ ok: true });
}
