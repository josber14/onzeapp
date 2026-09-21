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
  const [items, settings] = await Promise.all([
    prisma.p2PCapacity.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { id: "asc" },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { p2pCapacityServerAuthority: true },
    }),
  ]);
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
    saleParts: it.finalSaleParts || [],
    manualPaymentClp: it.manualPaymentClp !== null ? Number(it.manualPaymentClp) : null,
    manualPaymentsClp: it.manualPaymentsClp !== null ? Number(it.manualPaymentsClp) : null,
    manualPayments: it.manualPayments || [],
    createdAt: it.createdAt.toISOString(),
  }));
  return NextResponse.json({
    ok: true,
    items: normalized,
    // Ver AGENTS.md, "Motor de Capacity del lado del servidor" -- le avisa
    // al panel si esta cuenta ya está en modo autoritativo, para que deje de
    // auto-completar capacities por su cuenta (ver autoFinishP2PCapacities
    // en onze-panel.html).
    serverAuthority: !!settings?.p2pCapacityServerAuthority,
  });
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
  const manualAction = !!body?.manualAction;
  const { searchParams } = new URL(req.url);
  const confirmPost = searchParams.get("confirm");
  console.log("[P2P POST] from", session.email || session.tenantId, "id:", item?.id, "provider:", item?.provider, "confirm:", confirmPost, "referer:", req.headers.get("referer") || "none");

  if (!item?.id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const existing = await prisma.p2PCapacity.findUnique({ where: { id: String(item.id) } });
  if (existing && existing.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  const incomingStatus = String(item.status || "active");
  if (existing?.status === "finished" && incomingStatus === "active" && !confirmPost) {
    return NextResponse.json({ ok: false, error: "Capacity ya estaba finalizado en servidor" }, { status: 409 });
  }

  // Motor de Capacity del lado del servidor (ver AGENTS.md). Backstop de
  // respaldo para una pestaña vieja que no se enteró del modo autoritativo
  // (ver window.__p2pServerAuthority / autoFinishP2PCapacities en el panel):
  // si esta cuenta ya está en modo autoritativo, el cierre AUTOMÁTICO de un
  // capacity lo decide el cron del servidor, no el navegador. Un cierre
  // MANUAL explícito (manualAction=true, botón "Completar capacity") sigue
  // permitido siempre -- es una decisión deliberada del usuario, no el mismo
  // bug que este motor busca evitar.
  if (existing?.status === "active" && incomingStatus === "finished" && !manualAction) {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { p2pCapacityServerAuthority: true },
    });
    if (settings?.p2pCapacityServerAuthority) {
      return NextResponse.json(
        { ok: false, error: "Esta cuenta usa el motor de capacity del servidor -- el cierre automático lo hace el cron, no el navegador." },
        { status: 409 }
      );
    }
  }
  const data: any = {
    tenantId: session.tenantId,
    provider: String(item.provider || ""),
    capacityClp: Number(item.capacityClp || 0),
    buyPrice: Number(item.buyPrice || 0),
    usdtAmount: Number(item.usdtAmount || 0),
    date: String(item.date || ""),
    status: incomingStatus,
    finishedAt: item.finishedAt ? new Date(item.finishedAt) : null,
    finalSoldUsdt: item.finalSoldUsdt !== undefined && item.finalSoldUsdt !== null ? Number(item.finalSoldUsdt) : null,
    finalClpReceived: item.finalClpReceived !== undefined && item.finalClpReceived !== null ? Number(item.finalClpReceived) : null,
    finalCommissionUsdt: item.finalCommissionUsdt !== undefined && item.finalCommissionUsdt !== null ? Number(item.finalCommissionUsdt) : null,
    finalCommissionClp: item.finalCommissionClp !== undefined && item.finalCommissionClp !== null ? Number(item.finalCommissionClp) : null,
    finalSaleParts: (item.finalSaleParts && Array.isArray(item.finalSaleParts) ? item.finalSaleParts : null)
      || (item.saleParts && Array.isArray(item.saleParts) ? item.saleParts : null),
    manualPaymentClp: item.manualPaymentClp !== undefined && item.manualPaymentClp !== null ? Number(item.manualPaymentClp) : null,
    manualPaymentsClp: item.manualPaymentsClp !== undefined && item.manualPaymentsClp !== null ? Number(item.manualPaymentsClp) : null,
    manualPayments: Array.isArray(item.manualPayments) ? item.manualPayments : null,
  };
  const upserted = existing
    ? await prisma.p2PCapacity.update({ where: { id: String(item.id) }, data })
    : await prisma.p2PCapacity.create({ data: { id: String(item.id), ...data } });
  console.log("[P2P POST] upserted", upserted.id, "→ status:", upserted.status);
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
  const confirmDelete = searchParams.get("confirm");

  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }

  // Protección anti-borrado automático:
  // Solo permitimos borrar si viene desde el botón manual del panel.
  if (confirmDelete !== "manual") {
    return NextResponse.json(
      { ok: false, error: "DELETE bloqueado: falta confirmación manual" },
      { status: 409 }
    );
  }

  await prisma.p2PCapacity.deleteMany({
    where: { id, tenantId: session.tenantId },
  });

  return NextResponse.json({ ok: true });
}
