import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
      return Response.json({ ok: false, error: "url requerida" }, { status: 400 });
    }

    const decodedUrl = decodeURIComponent(url);
    if (!decodedUrl.startsWith("https://bin.bnbstatic.com/")) {
      return Response.json({ ok: false, error: "URL no permitida" }, { status: 403 });
    }

    const res = await fetch(decodedUrl);
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType.startsWith("image") ? contentType : "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
