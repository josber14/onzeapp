import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const label = searchParams.get("label") || "ONZE";

    const active = await prisma.p2PCycle.findFirst({
      where: { tenantId: session.tenantId, label, status: "active" },
      include: { manualSales: true },
    });

    const recent = await prisma.p2PCycle.findMany({
      where: { tenantId: session.tenantId, label, status: "closed" },
      orderBy: { startTime: "desc" },
      take: 100,
      include: { manualSales: true },
    });

    return Response.json({ ok: true, active, recent });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
