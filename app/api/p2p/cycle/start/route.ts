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

    const cycle = await prisma.p2PCycle.create({
      data: {
        tenantId: session.tenantId,
        label,
        status: "active",
        startTime: new Date(),
        minCloseBalance: minCloseBalance ?? undefined,
      },
    });

    return Response.json({ ok: true, cycle });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
