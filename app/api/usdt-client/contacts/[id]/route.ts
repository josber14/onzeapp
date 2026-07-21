import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyUsdtClientSessionToken, USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_NETWORKS = ["TRC20", "ERC20", "BEP20"];

async function getClient() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USDT_CLIENT_SESSION_COOKIE)?.value || null;
  const session = verifyUsdtClientSessionToken(token);
  if (!session) return null;
  const client = await prisma.usdtClient.findUnique({ where: { id: session.clientId } });
  if (!client || client.tenantId !== session.tenantId) return null;
  return client;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await getClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const contactId = Number(id);
  const existing = await prisma.usdtClientContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.clientId !== client.id) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const alias = String(body.alias || "").trim();
  const network = String(body.network || "").trim();
  const address = String(body.address || "").trim();

  if (!alias) return NextResponse.json({ ok: false, error: "Ingresa un alias" }, { status: 400 });
  if (!VALID_NETWORKS.includes(network)) return NextResponse.json({ ok: false, error: "Selecciona una red válida" }, { status: 400 });
  if (!address) return NextResponse.json({ ok: false, error: "Ingresa la dirección" }, { status: 400 });

  const contact = await prisma.usdtClientContact.update({
    where: { id: contactId },
    data: { alias, network, address },
  });
  return NextResponse.json({ ok: true, contact });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await getClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const contactId = Number(id);
  const existing = await prisma.usdtClientContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.clientId !== client.id) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  await prisma.usdtClientContact.delete({ where: { id: contactId } });
  return NextResponse.json({ ok: true });
}
