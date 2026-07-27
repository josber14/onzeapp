import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { SkipoClient } from "@/lib/skipo-adapter";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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

// Ejecuta la compra real — pedido explícito del usuario (jul 2026): sin
// PIN ni huella para este flujo puntual, solo la sesión de admin ya
// existente (requireAdmin).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!session.tenantId) return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const ordId = String(body.ordId || "");
  if (!ordId) return NextResponse.json({ ok: false, error: "Falta ordId" }, { status: 400 });

  // Reclama el ordId antes de llamar a Skipo -- si ya se confirmó (doble
  // clic, reintento de red), esto choca por PK y no se vuelve a ejecutar.
  try {
    await prisma.skipoConfirmLock.create({ data: { ordId, tenantId: session.tenantId } });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ ok: false, error: "Esta cotización ya fue confirmada antes -- no se volvió a ejecutar." }, { status: 409 });
    }
    throw e;
  }

  try {
    const client = new SkipoClient();
    const result = await client.confirmQuotation(ordId);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    // Skipo rechazó la confirmación (no que ya se haya ejecutado) -- libera
    // el ordId para permitir reintentar.
    await prisma.skipoConfirmLock.deleteMany({ where: { ordId } });
    return NextResponse.json({ ok: false, error: e.message || "No se pudo confirmar la compra" }, { status: 502 });
  }
}
