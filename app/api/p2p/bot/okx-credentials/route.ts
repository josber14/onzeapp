import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { testOkxCredentials } from "@/lib/p2p-bot/okx-adapter";

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
    const { prisma } = await import("@/lib/prisma");
    const creds = await prisma.okxCredentials.findFirst({
      where: { tenantId: session.tenantId, label },
      orderBy: { id: "asc" },
      select: { isActive: true, lastTestedAt: true, testStatus: true, apiKey: true, secretKey: true, passphrase: true },
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
    const label = req.nextUrl.searchParams.get("label") || "ONZE";
    const body = await req.json();
    const { apiKey, secretKey, passphrase, test } = body;

    if (apiKey && secretKey) {
      const { saveOkxCredentials } = await import("@/lib/p2p-bot/okx-adapter");
      await saveOkxCredentials(session.tenantId, apiKey, secretKey, passphrase, label);
    }

    if (test) {
      const result = await testOkxCredentials(session.tenantId, label);
      return Response.json({ ok: true, testResult: result });
    }

    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
