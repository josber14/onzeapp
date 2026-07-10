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

    const body = await req.json().catch(() => ({}));
    const label = body.label || "ONZE";
    const minCloseBalance = body.minCloseBalance ? Number(body.minCloseBalance) : null;

    const existing = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, label, status: "active" },
    });
    if (existing) {
      return Response.json({ ok: false, error: "Ya hay un ciclo activo para esta etiqueta", cycle: existing });
    }

    // El nuevo ciclo continúa exactamente donde terminó el último cerrado (un
    // instante después de su última orden capturada), no desde "ahora". Así,
    // si el usuario se demora en iniciar el siguiente ciclo, ninguna orden que
    // haya entrado en el medio queda sin contar. Si el ciclo anterior no tuvo
    // ninguna orden, se usa su hora de cierre. Si es el primer ciclo de todos,
    // arranca desde ahora (comportamiento original).
    const lastClosed = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, label, status: "closed" },
      orderBy: { id: "desc" },
    });

    let startTime = new Date();
    if (lastClosed?.lastOrderTime) {
      startTime = new Date(lastClosed.lastOrderTime.getTime() + 1);
    } else if (lastClosed?.endTime) {
      startTime = lastClosed.endTime;
    }

    const cycle = await prisma.p2PCycle.create({
      data: {
        tenantId: session.tenantId,
        label,
        status: "active",
        startTime,
        minCloseBalance: minCloseBalance ?? undefined,
      },
    });

    return Response.json({ ok: true, cycle });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
