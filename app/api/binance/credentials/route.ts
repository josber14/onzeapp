import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const creds = await prisma.binanceCredentials.findUnique({
      where: { tenantId: session.tenantId },
      select: { apiKey: true, secretKey: true, isActive: true, testStatus: true, lastTestedAt: true, updatedAt: true }
    });

    return Response.json({
      ok: true,
      credentials: creds || null,
      configured: !!creds,
      isActive: creds?.isActive || false,
      testStatus: creds?.testStatus || null,
      lastTestedAt: creds?.lastTestedAt || null,
      updatedAt: creds?.updatedAt || null,
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { apiKey, secretKey } = body;

    if (!apiKey || !secretKey) {
      return Response.json({ ok: false, error: "API Key y Secret Key son requeridos" }, { status: 400 });
    }

    await prisma.binanceCredentials.upsert({
      where: { tenantId: session.tenantId },
      update: { apiKey, secretKey, isActive: true, updatedAt: new Date() },
      create: { tenantId: session.tenantId, apiKey, secretKey, isActive: true },
    });

    return Response.json({ ok: true, message: "Credenciales guardadas correctamente" });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
