import { NextRequest, NextResponse } from "next/server";
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
  if (!session.tenantId) return { error: NextResponse.json({ error: "Falta tenantId" }, { status: 400 }) };
  return { session };
}

// Direcciones de retiro que el ADMIN precargó para un cliente puntual --
// decisión explícita del usuario (ago 2026): el cliente nunca escribe una
// dirección nueva y espera que funcione, solo elige entre las que el
// operador ya registró acá (y que ya existen como "contacto" whitelisteado
// del lado del proveedor, ver /api/admin/skipo-contacts).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const clientId = Number(searchParams.get("clientId"));
  if (!clientId) return NextResponse.json({ ok: false, error: "Falta clientId" }, { status: 400 });

  const addresses = await prisma.usdtWithdrawalAddress.findMany({
    where: { tenantId: session.tenantId!, clientId, active: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, addresses });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const body = await req.json().catch(() => ({}));
  const clientId = Number(body.clientId);
  const alias = String(body.alias || "").trim();
  const assetSymbol = String(body.assetSymbol || "USDT").trim();
  const networkSymbol = String(body.networkSymbol || "").trim();
  const address = String(body.address || "").trim();
  const providerContactId = String(body.providerContactId || "").trim();

  if (!clientId) return NextResponse.json({ ok: false, error: "Falta clientId" }, { status: 400 });
  if (!alias) return NextResponse.json({ ok: false, error: "Ingresa un alias" }, { status: 400 });
  if (!networkSymbol) return NextResponse.json({ ok: false, error: "Falta la red" }, { status: 400 });
  if (!address) return NextResponse.json({ ok: false, error: "Falta la dirección" }, { status: 400 });
  if (!providerContactId) return NextResponse.json({ ok: false, error: "Falta elegir el contacto del proveedor" }, { status: 400 });

  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ ok: false, error: "Cliente no encontrado" }, { status: 404 });
  }

  const created = await prisma.usdtWithdrawalAddress.create({
    data: { tenantId: session.tenantId!, clientId, alias, assetSymbol, networkSymbol, address, providerContactId },
  });
  return NextResponse.json({ ok: true, address: created });
}

// Desactiva (no borra) -- si ya hay retiros históricos apuntando a esta
// dirección, borrarla de verdad rompería esa referencia.
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });

  const result = await prisma.usdtWithdrawalAddress.updateMany({
    where: { id, tenantId: session.tenantId! },
    data: { active: false },
  });
  if (result.count === 0) return NextResponse.json({ ok: false, error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
