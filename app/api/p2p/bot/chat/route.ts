import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";
import { getBybitCredentials, BybitP2PClient } from "@/lib/p2p-bot/bybit-adapter";
import { binanceApiBase, binanceFetch } from "@/lib/p2p-bot/binance-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function buildQueryString(params: Record<string, any>): string {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderNo = searchParams.get("orderNo");
    const exchange = (searchParams.get("exchange") || "binance") as "binance" | "bybit" | "okx";

    if (!orderNo) {
      return Response.json({ ok: false, error: "orderNo requerido" }, { status: 400 });
    }

    if (exchange === "bybit") {
      return getBybitChat(session.tenantId, orderNo);
    }

    if (exchange !== "binance") {
      return Response.json({ ok: false, error: "Chat solo disponible para Binance y Bybit" });
    }

    const creds = await prisma.binanceCredentials.findFirst({
      where: { tenantId: session.tenantId, isActive: true },
    });
    if (!creds) {
      return Response.json({ ok: false, error: "Sin credenciales Binance" }, { status: 400 });
    }

    const allParams = {
      orderNo,
      page: 1,
      rows: 100,
      recvWindow: 60000,
      timestamp: Date.now(),
    };
    const queryStr = buildQueryString(allParams);
    const sig = sign(queryStr, creds.secretKey);
    const url = `${binanceApiBase()}/sapi/v1/c2c/chat/retrieveChatMessagesWithPagination?${queryStr}&signature=${encodeURIComponent(sig)}`;
    const res = await binanceFetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey, "Content-Type": "application/json" },
    });
    const data = await res.json();

    if (data?.code && data.code !== "000000") {
      return Response.json({ ok: false, error: data.message || "Error Binance" });
    }

    const messages = (data?.data || []).map((m: any) => ({
      id: m.id,
      uuid: m.uuid,
      type: m.type,
      content: m.type === "system" ? parseSystemContent(m.content) : m.content,
      self: m.self,
      fromNickName: m.fromNickName || null,
      createTime: m.createTime,
      status: m.status,
      imageUrl: m.imageUrl || null,
      thumbnailUrl: m.thumbnailUrl || null,
    }));

    // Sort by createTime ascending
    messages.sort((a: any, b: any) => Number(a.createTime) - Number(b.createTime));

    return Response.json({ ok: true, messages, orderNo });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// Espejo de lib/p2p-bot/chat-agent.ts (fetchMessages, rama bybit) -- esta
// ruta la usa el panel para que el operador VEA el chat manualmente, es
// código separado del que usa el bot para responder solo, así que hay que
// mantener el mismo parseo en los dos lados. Antes esta ruta ni siquiera
// intentaba Bybit (devolvía "Chat solo disponible para Binance"), por eso
// el panel mostraba "no hay mensajes" aunque el chat real sí tuviera
// mensajes -- confirmado contra la documentación oficial de Bybit, ver el
// fix de lib/p2p-bot/bybit-adapter.ts (jul 2026).
async function getBybitChat(tenantId: number, orderNo: string) {
  const creds = await getBybitCredentials(tenantId, "ONZE");
  if (!creds) {
    return Response.json({ ok: false, error: "Sin credenciales Bybit" }, { status: 400 });
  }
  try {
    const client = new BybitP2PClient(creds.apiKey, creds.secretKey);
    const [res, ownUserId] = await Promise.all([
      client.getChatMessages(orderNo, 1, 30),
      client.getOwnUserId(),
    ]);
    const raw = res?.result?.result ?? [];
    const messages = raw.map((m: any) => {
      const isImage = m.contentType === "pic";
      return {
        id: m.id,
        uuid: m.msgUuid,
        type: Number(m.msgType) === 0 ? "system" : isImage ? "image" : "text",
        content: isImage ? "" : String(m.message ?? ""),
        self: String(m.userId ?? "") === ownUserId,
        fromNickName: m.nickName || null,
        createTime: Number(m.createDate ?? 0),
        status: null,
        imageUrl: isImage ? (m.message ?? null) : null,
        thumbnailUrl: null,
      };
    }).sort((a: any, b: any) => Number(a.createTime) - Number(b.createTime));

    return Response.json({ ok: true, messages, orderNo });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

function parseSystemContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const labels: Record<string, string> = {
      seller_reason_expired: "⏰ El vendedor no respondió a tiempo — orden expirada",
      buyer_reason_expired: "⏰ El comprador no respondió a tiempo — orden expirada",
      seller_reason_cancel: "❌ El vendedor canceló la orden",
      buyer_reason_cancel: "❌ El comprador canceló la orden",
      appeal: "⚠️ Se abrió una apelación",
      release: "✅ Activos liberados",
      paid: "💳 El comprador confirmó el pago",
      appeal_result_buyer: "⚖️ Apelación resultó a favor del comprador",
      appeal_result_seller: "⚖️ Apelación resultó a favor del vendedor",
      order_created: "🆕 Orden creada",
      buyer_reason_expired_auto_cancel: "⏰ Orden cancelada automáticamente por tiempo de espera",
    };
    return labels[parsed.type] || `📌 ${parsed.type}`;
  } catch {
    return content;
  }
}
