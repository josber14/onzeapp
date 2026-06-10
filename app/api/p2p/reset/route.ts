import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const tenantId = session.tenantId;

  try {
    // 1. Eliminar todos los P2PCapacity del tenant (incluye initial capital)
    await prisma.p2PCapacity.deleteMany({
      where: { tenantId },
    });

    // 2. Eliminar el capital inicial especial
    await prisma.p2PCapacity.deleteMany({
      where: { id: `_p2p_initial_capital_${tenantId}` },
    }).catch(() => {});

    // 3. Eliminar órdenes Binance del tenant
    await prisma.binanceOrder.deleteMany({
      where: { tenantId },
    });

    // 4. Guardar cutoff para no re-importar órdenes viejas al sincronizar
    const cutoff = Date.now();
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { p2pResetCutoff: cutoff },
      create: { tenantId, p2pResetCutoff: cutoff },
    });

    return NextResponse.json({ ok: true, message: "Todos los datos P2P eliminados", cutoff });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Error al resetear datos P2P" },
      { status: 500 }
    );
  }
}
