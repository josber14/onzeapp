import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ ok: false, error: "Ingresa un correo" }, { status: 400 });
  }

  const [operator, usdtClient] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.usdtClient.findFirst({ where: { email }, select: { id: true, tenantId: true } }),
  ]);

  return NextResponse.json({
    ok: true,
    hasOperator: !!operator,
    hasUsdtClient: !!usdtClient,
    usdtTenantId: usdtClient?.tenantId ?? null,
  });
}
