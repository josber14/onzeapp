import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);
  if (!session) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  if (session.role !== "super_admin_global" && session.role !== "super_admin_cliente") {
    return { error: NextResponse.json({ error: "No tienes permisos." }, { status: 403 }) };
  }
  return { session };
}

// Historial de TODAS las compras completadas de Activos Digitales, de
// cualquier cliente — vista del operador.
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  const intents = await prisma.usdtPurchaseIntent.findMany({
    where: { tenantId: session.tenantId, status: "completed" },
    orderBy: { executedAt: "desc" },
    include: { client: { select: { fullName: true, email: true } } },
  });

  return NextResponse.json({
    ok: true,
    purchases: intents.map((i) => ({
      id: i.id,
      referenceCode: i.referenceCode,
      clientName: i.client?.fullName || "",
      clientEmail: i.client?.email || "",
      requestedClp: Number(i.requestedClp),
      receivedClp: Number(i.receivedClp),
      usdtAmount: i.usdtAmount ? Number(i.usdtAmount) : null,
      executedRate: i.executedRate ? Number(i.executedRate) : null,
      executedAt: i.executedAt,
    })),
  });
}
