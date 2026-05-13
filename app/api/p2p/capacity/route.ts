import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const items = await prisma.p2PCapacity.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
  });
  const normalized = items.map((it: any) => ({
    id: it.id,
    provider: it.provider,
    capacityClp: Number(it.capacityClp),
    buyPrice: Number(it.buyPrice),
    usdtAmount: Number(it.usdtAmount),
    date: it.date,
    status: it.status,
    finishedAt: it.finishedAt ? it.finishedAt.toISOString() : null,
    finalSoldUsdt: it.finalSoldUsdt !== null ? Number(it.finalSoldUsdt) : null,
    finalClpReceived: it.finalClpReceived !== null ? Number(it.finalClpReceived) : null,
    finalCommissionUsdt: it.finalCommissionUsdt !== null ? Number(it.finalCommissionUsdt) : null,
    finalCommissionClp: it.finalCommissionClp !== null ? Number(it.finalCommissionClp) : null,
    finalSaleParts: it.finalSaleParts || [],
    manualPaymentClp: it.manualPaymentClp !== null ? Number(it.manualPaymentClp) : null,
    manualPaymentsClp: it.manualPaymentsClp !== null ? Number(it.manualPaymentsClp) : null,
    createdAt: it.createdAt.toISOString(),
  }));
  return NextResponse.json({ ok: true, items: normalized });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json();
  const item = body?.item;
  if (!item?.id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const data: any = {
    tenantId: session.tenantId,
    provider: String(item.provider || ""),
    capacityClp: Number(item.capacityClp || 0),
    buyPrice: Number(item.buyPrice || 0),
    usdtAmount: Number(item.usdtAmount || 0),
    date: String(item.date || ""),
    status: String(item.status || "active"),
    finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
    finalSoldUsdt: item.finalSoldUsdt !== undefined && item.finalSoldUsdt !== null ? Number(item.finalSoldUsdt) : null,
    finalClpReceived: item.finalClpReceived !== undefined && item.finalClpReceived !== null ? Number(item.finalClpReceived) : null,
    finalCommissionUsdt: item.finalCommissionUsdt !== undefined && item.finalCommissionUsdt !== null ? Number(item.finalCommissionUsdt) : null,
    finalCommissionClp: item.finalCommissionClp !== undefined && item.finalCommissionClp !== null ? Number(item.finalCommissionClp) : null,
    finalSaleParts: item.finalSaleParts || null,
    manualPaymentClp: item.manualPaymentClp !== undefined && item.manualPaymentClp !== null ? Number(item.manualPaymentClp) : null,
    manualPaymentsClp: item.manualPaymentsClp !== undefined && item.manualPaymentsClp !== null ? Number(item.manualPaymentsClp) : null,
  };
  await prisma.p2PCapacity.upsert({
    where: { id: String(item.id) },
    update: data,
    create: { id: String(item.id), ...data },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  await prisma.p2PCapacity.deleteMany({
    where: { id, tenantId: session.tenantId },
  });
  return NextResponse.json({ ok: true });
}
