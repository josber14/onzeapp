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
