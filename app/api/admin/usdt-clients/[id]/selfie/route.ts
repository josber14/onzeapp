import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { get } from "@vercel/blob";

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

// Proxy de solo lectura para ver la selfie/cédula de un cliente — el blob es
// PRIVADO (no accesible con solo la URL), así que hay que traerlo del lado
// del servidor (con el token de Vercel Blob) y solo entregarlo si quien pide
// es un admin autenticado de este tenant.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;
  const clientId = Number(id);
  const client = await prisma.usdtClient.findUnique({ where: { id: clientId } });
  if (!client || client.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const selfieUrl = (client.kycData as any)?.selfieUrl;
  if (!selfieUrl) {
    return NextResponse.json({ error: "Sin selfie registrada" }, { status: 404 });
  }

  const result = await get(selfieUrl, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "No se pudo cargar la imagen" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: { "Content-Type": result.blob.contentType, "Cache-Control": "private, no-store" },
  });
}
