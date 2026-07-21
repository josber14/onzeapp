import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { SkipoClient } from "@/lib/skipo-adapter";

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

// Solo cotiza — no mueve dinero. Default: comprar USDT con CLP.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const quantity = String(body.quantity || "");
  const qtyCurrencyId = String(body.qtyCurrencyId || "CLP");
  const side = body.side === "SELL" ? "SELL" : "BUY";
  if (!quantity || Number(quantity) <= 0) {
    return NextResponse.json({ ok: false, error: "Ingresa un monto válido" }, { status: 400 });
  }

  try {
    const client = new SkipoClient();
    const quote = await client.getQuotation({
      baseCurrencyId: "USDT",
      quoteCurrencyId: "CLP",
      qtyCurrencyId,
      side,
      quantity,
    });
    return NextResponse.json({ ok: true, quote });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "No se pudo cotizar" }, { status: 502 });
  }
}
