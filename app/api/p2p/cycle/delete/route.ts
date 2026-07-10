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
    const { id, all, label } = body;

    if (all) {
      const result = await prisma.p2PCycle.deleteMany({
        where: { tenantId: session.tenantId, label: label || "ONZE", status: "closed" },
      });
      return Response.json({ ok: true, deleted: result.count });
    }

    if (!id) {
      return Response.json({ ok: false, error: "Falta id o all" });
    }

    const result = await prisma.p2PCycle.deleteMany({
      where: { id: Number(id), tenantId: session.tenantId, status: "closed" },
    });
    if (result.count === 0) {
      return Response.json({ ok: false, error: "Ciclo no encontrado o no está cerrado" });
    }

    return Response.json({ ok: true, deleted: result.count });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
