import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { getRpIdAndOrigin, buildRegistrationOptions } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { rpID } = getRpIdAndOrigin(req);
  const options = await buildRegistrationOptions({
    tenantId: session.tenantId,
    rpID,
    userName: session.email || `tenant-${session.tenantId}`,
    userDisplayName: session.fullName || session.email || "ONZE",
  });
  return NextResponse.json({ ok: true, options });
}
