import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BinanceP2PClient } from "@/lib/p2p-bot/binance-adapter";

export const dynamic = "force-dynamic";

const LABEL = "SOCIO";
const OVERLAP_BUFFER_MS = 2 * 60 * 60 * 1000; // 2h de colchón para no perder órdenes en el borde

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Solo lectura: usa client.getOrders(), nunca ningún método de escritura
// (updateAd/updateAdQuantity/postAd/removeAd) — este endpoint jamás debe tocar
// los anuncios de la cuenta del socio, solo leer su historial de órdenes.
export async function POST() {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const account = await prisma.partnerAccount.findUnique({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
  });
  if (!account) {
    return NextResponse.json({ ok: false, error: "No hay credenciales del socio configuradas" }, { status: 400 });
  }

  const client = new BinanceP2PClient(account.apiKey, account.secretKey);

  const now = Date.now();
  const startTimestamp = account.lastSyncedAt
    ? account.lastSyncedAt.getTime() - OVERLAP_BUFFER_MS
    : now - 90 * 24 * 60 * 60 * 1000; // primera sincronización: últimos 90 días

  let allOrders: any[] = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await client.getOrders({
        page,
        rows: 100,
        tradeType: "SELL",
        startTimestamp,
        endTimestamp: now,
      });
      const data = res?.data || [];
      if (data.length === 0) break;
      allOrders.push(...data);
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Error leyendo órdenes: ${e.message}` }, { status: 502 });
  }

  const completed = allOrders.filter((o: any) => o.orderStatus === "COMPLETED");

  let upserted = 0;
  for (const o of completed) {
    const orderNumber = String(o.orderNumber || "");
    if (!orderNumber) continue;
    await prisma.partnerSale.upsert({
      where: { tenantId_label_orderNumber: { tenantId: session.tenantId, label: LABEL, orderNumber } },
      update: {
        amount: Number(o.amount || 0),
        totalPrice: Number(o.totalPrice || 0),
        unitPrice: Number(o.unitPrice || 0),
        commission: o.commission !== undefined ? Number(o.commission) : null,
        fiat: String(o.fiat || "CLP"),
        orderStatus: String(o.orderStatus || "COMPLETED"),
        executedAt: new Date(Number(o.createTime) || now),
      },
      create: {
        tenantId: session.tenantId,
        label: LABEL,
        orderNumber,
        amount: Number(o.amount || 0),
        totalPrice: Number(o.totalPrice || 0),
        unitPrice: Number(o.unitPrice || 0),
        commission: o.commission !== undefined ? Number(o.commission) : null,
        fiat: String(o.fiat || "CLP"),
        orderStatus: String(o.orderStatus || "COMPLETED"),
        executedAt: new Date(Number(o.createTime) || now),
      },
    });
    upserted++;
  }

  await prisma.partnerAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date(now) },
  });

  return NextResponse.json({ ok: true, fetched: completed.length, upserted });
}
