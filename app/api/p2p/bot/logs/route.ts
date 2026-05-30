import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getBotLogs } from "@/lib/p2p-bot/engine";

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
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || 50);
    const level = searchParams.get("level") || undefined;
    const exchange = searchParams.get("exchange") || undefined;
    const logs = await getBotLogs(session.tenantId, limit, level, exchange);
    return Response.json({ ok: true, logs });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
