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
  // "Modo 2 anuncios" (oct 2026, pedido explícito del usuario): Bybit limita
  // esta cuenta a 2 anuncios de Venta/CLP simultáneos por ahora (confirmado
  // en vivo, error 912120060, no es cosa de nuestro código) -- hasta que eso
  // cambie, se arma Leader + Wing2 nada más, sin Wing3. El motor
  // (runBybitCycle) ya maneja esto solo: si no existe un anuncio wing3, el
  // leader nunca le "pasa el relevo" a nadie y simplemente se recrea en su
  // lugar, como cualquier anuncio normal.
  const maxAds = body?.maxAds === 2 ? 2 : 3;

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
  if (onlineSell.length > maxAds) {
    return NextResponse.json(
      {
        ok: false,
        error: `Hay ${onlineSell.length} anuncios de Venta en línea en Bybit -- este modo de la Estrategia Relevo necesita como máximo ${maxAds}. Apaga (bot) los que sobren desde el panel y vuelve a intentar.`,
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

  // Pedido explícito del usuario (confirmado leyendo el anuncio real: margen
  // de seguridad 1.31%, capital mínimo competidor 5, circuit breaker 1%,
  // etc. -- todos MÁS estrictos que el fallback a nivel de exchange de
  // Bybit): un anuncio nuevo (wing2/wing3) creado por este botón debe
  // heredar la MISMA configuración de seguridad que ya tenía el leader, no
  // quedar en null y caer al fallback del exchange (que puede ser menos
  // estricto, como en este caso 0.26% en vez de 1.31%). Solo se copia al
  // CREAR una fila nueva -- si el anuncio ya existía con su propia
  // configuración (caso de 2 o 3 anuncios ya armados a mano), esa
  // configuración se respeta tal cual, sin pisarla.
  const SAFETY_FIELDS = [
    "botPriceSource", "botPriceFloorPct", "botSafeMarginPct",
    "botMinCompetitorCapital", "botCompeteTransAmount", "botCompetePayTypes",
    "botExcludedMerchants", "botMatchAllowedMerchants", "botCycleInterval",
    "botCircuitBreakPct", "botMinAdPriceDiffPct",
  ] as const;

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
    if (leaderRow) {
      for (const field of SAFETY_FIELDS) {
        if (leaderRow[field] != null) data[field] = leaderRow[field];
      }
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
    // Bybit rechaza (90043) crear un anuncio nuevo con un precio a menos de
    // 0.1% de diferencia de uno YA existente -- al clonar el leader para
    // crear wing2/wing3, el precio de arranque es literalmente el mismo,
    // así que siempre choca con esto. No importa el precio exacto de
    // arranque (el motor lo corrige solo desde el primer ciclo) -- mismo
    // patrón de reintento con precio ajustado que ya usa la recreación en
    // engine.ts, con más pasos acá porque wing2 Y wing3 compiten por el
    // mismo "hueco" de precio contra el leader Y entre sí.
    let newId: string | null = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 4 && !newId; attempt++) {
      const bump = 1 + 0.003 * (attempt + 1); // 0.3%, 0.6%, 0.9%, 1.2%
      if (attempt > 0) postFields.price = (newPrice * bump).toFixed(2);
      try {
        const res = await client.postAd(postFields);
        newId = res?.result?.itemId ?? res?.result?.item?.id ?? res?.result?.id ?? null;
        if (!newId) lastErr = new Error(`Bybit no devolvió el id del anuncio nuevo (respuesta: ${JSON.stringify(res).slice(0, 300)})`);
      } catch (e: any) {
        lastErr = e;
        if (!String(e.message).includes("90043")) break; // otro error -- no insistir con el mismo truco
      }
    }
    if (!newId) {
      throw lastErr || new Error("No se pudo crear el anuncio clonado");
    }
    return { ...sourceAd, id: String(newId), price: Number(postFields.price) };
  }

  const created: { role: string; adId: string; wasCloned: boolean }[] = [];
  try {
    // Leader: el que ya existe, se le asigna el rol, sin tocar su precio.
    await ensureLocalRow(leaderAd, "leader");
    created.push({ role: "leader", adId: String(leaderAd.id), wasCloned: false });

    // Wing2 y wing3: usan los anuncios 2do y 3ro si ya existían (hay 2 o 3),
    // o se clonan nuevos en Bybit si faltan (hay solo 1). "Modo 2 anuncios":
    // solo se arma wing2, sin wing3 -- ver comentario de maxAds más arriba.
    const roles: Array<"wing2" | "wing3"> = maxAds === 2 ? ["wing2"] : ["wing2", "wing3"];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      let ad = ordered[i + 1];
      let wasCloned = false;
      if (!ad) {
        // Falta este anuncio -- clonar el leader en Bybit como punto de
        // partida (mismos métodos de pago/límites/cantidad, mismo precio
        // inicial -- el motor lo ajusta solo desde el primer ciclo).
        ad = await cloneAdOnBybit(leaderAd, Number(leaderAd.price));
        wasCloned = true;
      }
      await ensureLocalRow(ad, role);
      created.push({ role, adId: String(ad.id), wasCloned });
    }
  } catch (e: any) {
    // Bug real confirmado en vivo (oct 2026, dos incidentes seguidos):
    // 1) Si la activación fallaba a mitad de camino, el leader quedaba con
    //    botRelevoRole="leader" guardado -- bloqueaba cualquier intento
    //    futuro (el chequeo de "ya activa" de arriba lo detectaba como si
    //    el relevo ya estuviera armado). Eso ya se arregla abajo (limpiar
    //    el rol de TODO lo tocado en este intento).
    // 2) Más grave: si wing2 SÍ se alcanzó a clonar en Bybit de verdad (un
    //    anuncio real nuevo) antes de que wing3 fallara, ese anuncio
    //    quedaba VIVO y gestionado (botEnabled:true) con el rol ya
    //    limpiado -- el ciclo normal lo tomaba como un anuncio "top1" común
    //    SIN su propia configuración completa, y terminó publicando un
    //    precio real por debajo del margen de seguridad esperado
    //    (confirmado en vivo por el usuario, $993, tuvo que borrarlo a mano
    //    en la app). Ahora, cualquier anuncio que este intento haya CLONADO
    //    de verdad en Bybit se borra de Bybit y de nuestra base por
    //    completo si la activación no se completa -- nunca queda un
    //    anuncio real huérfano compitiendo solo. El leader (nunca clonado,
    //    siempre preexistente) solo se le limpia el rol, no se borra.
    for (const item of created) {
      try {
        if (item.wasCloned) {
          try { await client.removeAd(item.adId); } catch (_) {}
          await prisma.p2PBotAd.deleteMany({ where: { tenantId, exchange: "bybit", label, adId: item.adId } });
        } else {
          await prisma.p2PBotAd.updateMany({
            where: { tenantId, exchange: "bybit", label, adId: item.adId },
            data: { botRelevoRole: null, botRelevoTickStep: null, botRelevoTickBudget: null },
          });
        }
      } catch (_) {}
    }
    return NextResponse.json(
      { ok: false, error: `Error activando la estrategia: ${e.message}. Se deshizo lo que se alcanzó a configurar -- puedes volver a intentar.` },
      { status: 500 }
    );
  }

  // Wing2 sin diferencia configurada todavía -- pedido explícito del
  // usuario: usa el MISMO paso chico que el leader (0,01 contra el 2do
  // lugar real), no uno más grande -- el leader ya va a terminar más abajo
  // de forma natural (baja de a poquito sin parar, no solo "compite contra
  // el 2do lugar"), así que no hace falta un margen extra para que wing2
  // quede ordenado detrás de él.
  const wing2Row = await prisma.p2PBotAd.findFirst({ where: { tenantId, exchange: "bybit", label, botRelevoRole: "wing2" } });
  if (wing2Row && wing2Row.botTop1Diff == null) {
    await prisma.p2PBotAd.update({ where: { id: wing2Row.id }, data: { botTop1Diff: tickStep } });
  }

  return NextResponse.json({ ok: true, created });
}
