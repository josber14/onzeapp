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

export async function GET() {
  const client = await getClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const contacts = await prisma.usdtClientContact.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, contacts });
}

export async function POST(req: NextRequest) {
  const client = await getClient();
  if (!client) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const alias = String(body.alias || "").trim();
  const network = String(body.network || "").trim();
  const address = String(body.address || "").trim();

  if (!alias) return NextResponse.json({ ok: false, error: "Ingresa un alias" }, { status: 400 });
  if (!VALID_NETWORKS.includes(network)) return NextResponse.json({ ok: false, error: "Selecciona una red válida" }, { status: 400 });
  if (!address) return NextResponse.json({ ok: false, error: "Ingresa la dirección" }, { status: 400 });

  const contact = await prisma.usdtClientContact.create({
    data: { clientId: client.id, alias, network, address, currency: "USDT" },
  });
  return NextResponse.json({ ok: true, contact });
}
