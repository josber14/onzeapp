import { NextResponse } from "next/server";
import { USDT_CLIENT_SESSION_COOKIE } from "@/lib/usdt-client-session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(USDT_CLIENT_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
