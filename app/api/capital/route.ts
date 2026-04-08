import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDecimalString(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return String(num);
}

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

async function resolveCountryByNameOrCode(input: string) {
  const clean = String(input || "").trim();
  if (!clean) return null;

  const byCode = await prisma.country.findFirst({
    where: { code: clean.toUpperCase() },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  if (byCode) return byCode;

  const byName = await prisma.country.findFirst({
    where: { name: clean },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  if (byName) return byName;

  return prisma.country.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const capitals = await prisma.initialCapital.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ createdAt: "asc" }],
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
            currencyCode: true,
            flagEmoji: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      items: capitals.map((item) => ({
        id: item.id,
        country: item.country.name,
        countryCode: item.country.code,
        currency: item.currencyCode,
        amount: Number(item.amount),
        note: item.note || "",
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    console.error("CAPITAL_GET_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo cargar el capital inicial." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const body = await req.json();

    const countryInput = String(body?.country || "").trim();
    const currency = String(body?.currency || "").trim().toUpperCase();
    const amountStr = toDecimalString(body?.amount);
    const note = String(body?.note || "").trim();

    if (!countryInput) {
      return NextResponse.json({ error: "El país es obligatorio." }, { status: 400 });
    }
    if (!currency) {
      return NextResponse.json({ error: "La moneda es obligatoria." }, { status: 400 });
    }
    if (!amountStr || Number(amountStr) < 0) {
      return NextResponse.json({ error: "Monto inválido." }, { status: 400 });
    }

    const country = await resolveCountryByNameOrCode(countryInput);

    if (!country) {
      return NextResponse.json({ error: "No se encontró el país indicado." }, { status: 404 });
    }

    const saved = await prisma.initialCapital.upsert({
      where: {
        tenantId_countryId_currencyCode: {
          tenantId: session.tenantId,
          countryId: country.id,
          currencyCode: currency,
        },
      },
      update: {
        amount: amountStr,
        note: note || null,
      },
      create: {
        tenantId: session.tenantId,
        countryId: country.id,
        currencyCode: currency,
        amount: amountStr,
        note: note || null,
      },
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
            currencyCode: true,
            flagEmoji: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      item: {
        id: saved.id,
        country: saved.country.name,
        countryCode: saved.country.code,
        currency: saved.currencyCode,
        amount: Number(saved.amount),
        note: saved.note || "",
        createdAt: saved.createdAt,
      },
    });
  } catch (error) {
    console.error("CAPITAL_POST_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo guardar el capital inicial." },
      { status: 500 }
    );
  }
}
