import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { cycleId, concept, amountClp } = body;
    if (!cycleId || !concept || !amountClp) {
      return Response.json({ ok: false, error: "Faltan campos: cycleId, concept, amountClp" });
    }

    const cycle = await prisma.p2PCycle.findFirst({
      where: { id: cycleId, tenantId: session.tenantId },
    });
    if (!cycle) {
      return Response.json({ ok: false, error: "Ciclo no encontrado" });
    }
    if (cycle.status !== "active") {
      return Response.json({ ok: false, error: "El ciclo no está activo" });
    }

    const sale = await prisma.p2PCycleManualSale.create({
      data: {
        cycleId,
        concept,
        amountClp: Number(amountClp),
      },
    });

    const totalManualClp = Number(cycle.totalManualClp) + Number(amountClp);
    await prisma.p2PCycle.update({
      where: { id: cycleId },
      data: { totalManualClp },
    });

    return Response.json({ ok: true, sale, totalManualClp });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// Pedido explícito del usuario (sep 2026): borrar una venta manual cargada
// por error (ej. duplicada) del ciclo ACTIVO. Solo se permite mientras el
// ciclo sigue activo -- mismo criterio que el POST de arriba, para no
// alterar retroactivamente los totales de un ciclo ya cerrado.
export async function DELETE(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) {
      return Response.json({ ok: false, error: "Falta id" }, { status: 400 });
    }

    const sale = await prisma.p2PCycleManualSale.findUnique({
      where: { id },
      include: { cycle: true },
    });
    if (!sale || sale.cycle.tenantId !== session.tenantId) {
      return Response.json({ ok: false, error: "Venta manual no encontrada" }, { status: 404 });
    }
    if (sale.cycle.status !== "active") {
      return Response.json({ ok: false, error: "El ciclo ya no está activo" }, { status: 400 });
    }

    await prisma.p2PCycleManualSale.delete({ where: { id } });
    const totalManualClp = Math.max(0, Number(sale.cycle.totalManualClp) - Number(sale.amountClp));
    await prisma.p2PCycle.update({
      where: { id: sale.cycleId },
      data: { totalManualClp },
    });

    return Response.json({ ok: true, totalManualClp });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
