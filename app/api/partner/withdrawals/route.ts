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

// Registro libre de movimientos que restan del capital -- dos tipos (`kind`):
// "retiro" (Hector / Josber sacan plata) y "gasto" (ej: pago del PPM, un
// gasto del negocio). Ambos se tratan exactamente igual para el cálculo del
// capital -- pedido explícito del usuario (ago 2026): cada uno se resta al
// instante del "Capital P2P" (ver socioBnLoadDashboard en onze-panel.html:
// capital = inicial + ganancia acumulada - suma de TODOS los movimientos,
// sin "cerrar período"). Solo cambia cómo se muestran en la lista.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const withdrawals = await prisma.partnerWithdrawal.findMany({
    where: {
      tenantId: session.tenantId,
      label: LABEL,
      ...(from ? { withdrawnAt: { gte: new Date(from + "T00:00:00.000Z"), ...(to ? { lte: new Date(to + "T23:59:59.999Z") } : {}) } } : {}),
    },
    orderBy: { withdrawnAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    ok: true,
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      kind: w.kind,
      person: w.person,
      amountUsdt: Number(w.amountUsdt),
      note: w.note,
      withdrawnAt: w.withdrawnAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "gasto" ? "gasto" : "retiro";
  const person = String(body?.person || "").trim();
  const amountUsdt = Number(body?.amountUsdt);
  const note = body?.note ? String(body.note).slice(0, 300) : null;
  const withdrawnAt = body?.withdrawnAt ? new Date(body.withdrawnAt) : new Date();

  if (!person) {
    return NextResponse.json({
      ok: false,
      error: kind === "gasto" ? "Falta indicar el concepto del gasto" : "Falta indicar quién retiró",
    }, { status: 400 });
  }
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return NextResponse.json({ ok: false, error: "Monto inválido" }, { status: 400 });
  }
  if (Number.isNaN(withdrawnAt.getTime())) {
    return NextResponse.json({ ok: false, error: "Fecha inválida" }, { status: 400 });
  }

  const account = await prisma.partnerAccount.findUnique({
    where: { tenantId_label: { tenantId: session.tenantId, label: LABEL } },
  });
  if (!account) {
    return NextResponse.json({ ok: false, error: "Primero conecta la cuenta del socio" }, { status: 400 });
  }

  const withdrawal = await prisma.partnerWithdrawal.create({
    data: { tenantId: session.tenantId, label: LABEL, kind, person, amountUsdt, note, withdrawnAt },
  });

  return NextResponse.json({
    ok: true,
    withdrawal: {
      id: withdrawal.id,
      kind: withdrawal.kind,
      person: withdrawal.person,
      amountUsdt: Number(withdrawal.amountUsdt),
      note: withdrawal.note,
      withdrawnAt: withdrawal.withdrawnAt.toISOString(),
    },
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  const result = await prisma.partnerWithdrawal.deleteMany({
    where: { id, tenantId: session.tenantId, label: LABEL },
  });
  if (result.count === 0) {
    return NextResponse.json({ ok: false, error: "Retiro no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
