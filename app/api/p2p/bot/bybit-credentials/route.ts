import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { testBybitCredentials } from "@/lib/p2p-bot/bybit-adapter";

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
    const { prisma } = await import("@/lib/prisma");
    const creds = await prisma.bybitCredentials.findUnique({
      where: { tenantId: session.tenantId },
      select: {
        isActive: true,
        lastTestedAt: true,
        testStatus: true,
        apiKey: true,
        secretKey: true,
      },
    });
    return Response.json({ ok: true, credentials: creds });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    const body = await req.json();
    const { apiKey, secretKey, test } = body;

    if (apiKey && secretKey) {
      const { saveBybitCredentials } = await import("@/lib/p2p-bot/bybit-adapter");
      await saveBybitCredentials(session.tenantId, apiKey, secretKey);
    }

    if (test) {
      const result = await testBybitCredentials(session.tenantId);
      return Response.json({ ok: true, testResult: result });
    }

    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
