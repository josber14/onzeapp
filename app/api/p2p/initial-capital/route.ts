import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function capitalRecordId(tenantId: number) {
  return `_p2p_initial_capital_${tenantId}`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const record = await prisma.p2PCapacity.findUnique({
      where: { id: capitalRecordId(session.tenantId) },
    });

    return Response.json({
      ok: true,
      value: Number(record?.capacityClp || 0),
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error obteniendo capital inicial" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { value } = await req.json();

    await prisma.p2PCapacity.upsert({
      where: { id: capitalRecordId(session.tenantId) },
      update: { capacityClp: Number(value || 0) },
      create: {
        id: capitalRecordId(session.tenantId),
        tenantId: session.tenantId,
        capacityClp: Number(value || 0),
        buyPrice: 0,
        usdtAmount: 0,
        provider: "_initial_capital",
        status: "_capital",
        date: new Date().toISOString().slice(0, 10),
      },
    });

    return Response.json({ ok: true, value: Number(value || 0) });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message || "Error guardando capital inicial" },
      { status: 500 }
    );
  }
}
