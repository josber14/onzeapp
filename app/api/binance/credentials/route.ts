import { NextRequest } from "next/server";
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

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const label = req.nextUrl.searchParams.get("label") || "ONZE";

    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId: session.tenantId, label },
      orderBy: { id: "asc" },
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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { apiKey, secretKey } = body;
    const label = body.label || request.nextUrl.searchParams.get("label") || "ONZE";

    if (!apiKey || !secretKey) {
      return Response.json({ ok: false, error: "API Key y Secret Key son requeridos" }, { status: 400 });
    }

    const existing = await prisma.binanceCredentials.findFirst({
      where: { tenantId: session.tenantId, label },
    });
    if (existing) {
      await prisma.binanceCredentials.update({
        where: { id: existing.id },
        data: { apiKey, secretKey, isActive: true, updatedAt: new Date() },
      });
    } else {
      await prisma.binanceCredentials.create({
        data: { tenantId: session.tenantId, label, apiKey, secretKey, isActive: true },
      });
    }

    return Response.json({ ok: true, message: "Credenciales guardadas correctamente" });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
