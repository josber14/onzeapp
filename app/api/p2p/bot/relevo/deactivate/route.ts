import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";

export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

async function getBybitClient(tenantId: number, label = "ONZE") {
  const creds = await prisma.bybitCredentials.findFirst({
    where: { tenantId, isActive: true, label },
    orderBy: { id: "asc" },
  });
  if (!creds) return null;
  return new BybitP2PClient(creds.apiKey, creds.secretKey);
}

// "Estrategia Relevo" (oct 2026): desarma los 3 anuncios coordinados y deja
// solo el leader compitiendo "Top 1" normal. Wing2/wing3 se borran de verdad
// en Bybit, no solo se les apaga el bot -- pedido explícito del usuario.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json().catch(() => ({}));
  const label = body?.label || "ONZE";

  const rows = await prisma.p2PBotAd.findMany({
    where: { tenantId, exchange: "bybit", label, tradeType: "SELL", botRelevoRole: { in: ["leader", "wing2", "wing3"] } },
  });
  const leaderRow = rows.find((r) => r.botRelevoRole === "leader");
  if (!leaderRow) {
    return NextResponse.json({ ok: false, error: "La Estrategia Relevo no está activa." }, { status: 409 });
  }

  const client = await getBybitClient(tenantId, label);

  const toRemove = rows.filter((r) => r.botRelevoRole !== "leader");
  const removed: string[] = [];
  const failed: string[] = [];
  for (const row of toRemove) {
    try {
      if (client && row.adId) await client.removeAd(row.adId);
      removed.push(row.adId || String(row.id));
    } catch (e: any) {
      // Si ya no existe del lado de Bybit (ej. lo borraron a mano), no
      // bloquea la desactivación -- igual se limpia la fila local.
      failed.push(`${row.adId}: ${e.message}`);
    }
    await prisma.p2PBotAd.deleteMany({ where: { id: row.id, tenantId } });
  }

  // El leader sobrevive, vuelve a ser un anuncio normal "Top 1". Si no tenía
  // una diferencia configurada todavía, se le deja un valor de arranque
  // razonable en vez de 0.
  await prisma.p2PBotAd.update({
    where: { id: leaderRow.id },
    data: {
      botRelevoRole: null,
      botRelevoTickStep: null,
      botRelevoTickBudget: null,
      botStrategy: "top1",
      ...(leaderRow.botTop1Diff == null ? { botTop1Diff: 0.1 } : {}),
    },
  });

  return NextResponse.json({ ok: true, removed, failed });
}
