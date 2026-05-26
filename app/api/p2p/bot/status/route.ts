import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getBotStatus } from "@/lib/p2p-bot/engine";

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
    const status = await getBotStatus(session.tenantId);
    return Response.json({ ok: true, status });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
