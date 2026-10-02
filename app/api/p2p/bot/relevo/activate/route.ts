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

// "Estrategia Relevo" (oct 2026, pedido explícito del usuario): un solo botón
// que arma los 3 anuncios coordinados (leader/wing2/wing3) solo, en vez de
// tener que asignar el rol a mano en cada anuncio. Ver AGENTS.md / el plan de
// esta sesión para el diseño completo.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const body = await req.json().catch(() => ({}));
  const label = body?.label || "ONZE";
  const tickStep = body?.tickStep != null && body.tickStep !== "" ? Number(body.tickStep) : 0.01;
  const tickBudget = body?.tickBudget != null && body.tickBudget !== "" ? Number(body.tickBudget) : 20;

  const bybitClient = await getBybitClient(tenantId, label);
  if (!bybitClient) {
    return NextResponse.json({ ok: false, error: "Sin credenciales Bybit" }, { status: 400 });
  }
  const client = bybitClient;

  // Ya activa (hay un leader) -- no hacer nada, evita crear anuncios de más
  // si el usuario presiona el botón 2 veces.
  const existingLeader = await prisma.p2PBotAd.findFirst({
    where: { tenantId, exchange: "bybit", label, tradeType: "SELL", botRelevoRole: "leader" },
  });
  if (existingLeader) {
    return NextResponse.json({ ok: false, error: "La Estrategia Relevo ya está activa." }, { status: 409 });
  }

  let myAdsRes: any;
  try {
    myAdsRes = await client.getMyAds(1, 50);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Bybit API error: ${e.message}` }, { status: 500 });
  }
  const rawItems: any[] = myAdsRes?.result?.items || [];
  // Ads reales, en línea, de Venta USDT/CLP -- de-duplicados por su propio id
  // real de Bybit (si hay 2 filas locales apuntando al mismo anuncio real,
  // acá cuentan como 1 solo, que es lo que importa para decidir cuántos
  // faltan por crear).
  const onlineSellMap = new Map<string, any>();
  for (const a of rawItems) {
    if (Number(a.status) === 10 && a.side === 1 && String(a.tokenId).toUpperCase() === "USDT" && String(a.currencyId).toUpperCase() === "CLP") {
      onlineSellMap.set(String(a.id), a);
    }
  }
  const onlineSell = [...onlineSellMap.values()];

  if (onlineSell.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Necesitas al menos 1 anuncio de Venta creado en Bybit para activar la estrategia." },
      { status: 400 }
    );
  }
  if (onlineSell.length > 3) {
    return NextResponse.json(
      {
        ok: false,
        error: `Hay ${onlineSell.length} anuncios de Venta en línea en Bybit -- la Estrategia Relevo necesita como máximo 3. Apaga (bot) los que sobren desde el panel y vuelve a intentar.`,
      },
      { status: 400 }
    );
  }

  // Filas locales existentes para cada anuncio real -- una por adId (si hay
  // duplicados, se usa la más recientemente actualizada y se ignora el resto,
  // sin borrarlas; no es responsabilidad de este endpoint limpiar eso).
  const localRows = await prisma.p2PBotAd.findMany({
    where: { tenantId, exchange: "bybit", label, tradeType: "SELL", adId: { in: onlineSell.map((a) => String(a.id)) } },
    orderBy: { updatedAt: "desc" },
  });
  const localByAdId = new Map<string, any>();
  for (const row of localRows) {
    if (!localByAdId.has(row.adId!)) localByAdId.set(row.adId!, row);
  }

  // Orden determinístico: el anuncio con la fila local más antigua (createdAt)
  // es el que se vuelve leader; si un anuncio real no tiene fila local
  // todavía, se le crea una (botEnabled true) y cuenta como el más nuevo.
  const ordered = [...onlineSell].sort((a, b) => {
    const rowA = localByAdId.get(String(a.id));
    const rowB = localByAdId.get(String(b.id));
    const tA = rowA ? new Date(rowA.createdAt).getTime() : Infinity;
    const tB = rowB ? new Date(rowB.createdAt).getTime() : Infinity;
    return tA - tB;
  });

  const leaderAd = ordered[0];
  const leaderRow = localByAdId.get(String(leaderAd.id));

  async function ensureLocalRow(ad: any, role: string) {
    const existing = localByAdId.get(String(ad.id));
    const data: any = {
      tenantId,
      label,
      exchange: "bybit",
      adId: String(ad.id),
      tradeType: "SELL",
      asset: ad.tokenId || "USDT",
      fiat: ad.currencyId || "CLP",
      priceType: ad.priceType === 0 ? "fixed" : "float",
      price: Number(ad.price) || 0,
      amount: Number(ad.lastQuantity ?? ad.quantity ?? 0) || 0,
      minAmount: Number(ad.minAmount) || 0,
      maxAmount: Number(ad.maxAmount) || 0,
      status: "online",
      isActive: true,
      botManaged: true,
      botEnabled: true,
      botRelevoRole: role,
      botRelevoTickStep: role === "leader" || role === "wing3" ? tickStep : null,
      botRelevoTickBudget: role === "leader" ? tickBudget : null,
    };
    if (existing) {
      return prisma.p2PBotAd.update({ where: { id: existing.id }, data });
    }
    return prisma.p2PBotAd.create({ data });
  }

  // Clona la configuración completa de un anuncio real (mismo patrón que ya
  // usa la recreación en engine.ts: todo sale de getMyAds, sin necesitar
  // getAdDetail) para publicar un anuncio nuevo real en Bybit.
  async function cloneAdOnBybit(sourceAd: any, newPrice: number): Promise<any> {
    const payObjs = sourceAd.paymentTerms ?? sourceAd.payments ?? [];
    const paymentIds = Array.isArray(payObjs) ? payObjs.map((p: any) => String(p.id ?? p.paymentId ?? p)) : [];
    const tps = sourceAd.tradingPreferenceSet ?? {};
    const strTps: any = {};
    for (const k of Object.keys(tps)) strTps[k] = String(tps[k] ?? "");
    const postFields: any = {
      tokenId: "USDT",
      currencyId: "CLP",
      side: "1",
      price: newPrice.toFixed(2),
      priceType: String(sourceAd.priceType ?? "0"),
      premium: String(sourceAd.premium ?? "0"),
      quantity: String(sourceAd.lastQuantity ?? sourceAd.quantity ?? "0"),
      minAmount: String(sourceAd.minAmount ?? "0"),
      maxAmount: String(sourceAd.maxAmount ?? "0"),
      paymentPeriod: String(sourceAd.paymentPeriod ?? "15"),
      paymentIds,
      remark: String(sourceAd.remark ?? ""),
      tradingPreferenceSet: strTps,
      itemType: String(sourceAd.itemType ?? "ORIGIN"),
      status: 10,
    };
    const res = await client.postAd(postFields);
    const newId = res?.result?.itemId ?? res?.result?.item?.id ?? res?.result?.id;
    if (!newId) {
      throw new Error(`Bybit no devolvió el id del anuncio nuevo (respuesta: ${JSON.stringify(res).slice(0, 300)})`);
    }
    return { ...sourceAd, id: String(newId), price: newPrice };
  }

  const created: { role: string; adId: string }[] = [];
  try {
    // Leader: el que ya existe, se le asigna el rol, sin tocar su precio.
    await ensureLocalRow(leaderAd, "leader");
    created.push({ role: "leader", adId: String(leaderAd.id) });

    // Wing2 y wing3: usan los anuncios 2do y 3ro si ya existían (hay 2 o 3),
    // o se clonan nuevos en Bybit si faltan (hay solo 1).
    const roles: Array<"wing2" | "wing3"> = ["wing2", "wing3"];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      let ad = ordered[i + 1];
      if (!ad) {
        // Falta este anuncio -- clonar el leader en Bybit como punto de
        // partida (mismos métodos de pago/límites/cantidad, mismo precio
        // inicial -- el motor lo ajusta solo desde el primer ciclo).
        ad = await cloneAdOnBybit(leaderAd, Number(leaderAd.price));
      }
      await ensureLocalRow(ad, role);
      created.push({ role, adId: String(ad.id) });
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Error activando la estrategia: ${e.message}. Revisa el panel -- puede que algún anuncio haya quedado a medio configurar.` },
      { status: 500 }
    );
  }

  // Wing2 sin diferencia configurada todavía -- le damos una de arranque más
  // grande que el paso del leader, para que quede ordenado detrás de él
  // (estrategia "top1" normal, sin código nuevo -- ver engine.ts).
  const wing2Row = await prisma.p2PBotAd.findFirst({ where: { tenantId, exchange: "bybit", label, botRelevoRole: "wing2" } });
  if (wing2Row && wing2Row.botTop1Diff == null) {
    await prisma.p2PBotAd.update({ where: { id: wing2Row.id }, data: { botTop1Diff: Math.max(tickStep * 5, 0.5) } });
  }

  return NextResponse.json({ ok: true, created });
}
