import { NextRequest, NextResponse } from "next/server";

type SessionRole =
  | "super_admin_global"
  | "super_admin_cliente"
  | "operador";

type SessionPayload = {
  userId: number;
  email: string;
  fullName: string;
  role: SessionRole;
  exp: number;
};

const SESSION_SECRET =
  process.env.SESSION_SECRET || "onze-dev-secret-cambiar-en-produccion";

function hexToUint8Array(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

function base64UrlToString(value: string) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(base64);
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySessionToken(
  token?: string | null
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = await sign(encodedPayload);

  if (
    !timingSafeEqual(
      hexToUint8Array(providedSignature),
      hexToUint8Array(expectedSignature)
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlToString(encodedPayload)) as SessionPayload;

    if (!payload?.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("onze_session")?.value || null;
  const session = await verifySessionToken(token);

  const isAdminRoute = pathname.startsWith("/admin");
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isLoginRoute = pathname.startsWith("/login");

  if (!session && (isAdminRoute || isDashboardRoute)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (session && isLoginRoute) {
    if (
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente"
    ) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }

    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (session && isAdminRoute) {
    const isAdmin =
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente";

    if (!isAdmin) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/login"],
};