import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { BalanceMovementDirection, BalanceMovementType } from "@prisma/client";

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

    const expenses = await prisma.expense.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
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
        createdByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      expenses: expenses.map((exp) => ({
        id: exp.id,
        date: exp.expenseDate,
        category: exp.category,
        country: exp.country.name,
        countryCode: exp.country.code,
        currency: exp.currencyCode,
        amount: Number(exp.amount),
        note: exp.note || "",
        createdAt: exp.createdAt,
        createdByUser: exp.createdByUser
          ? {
              id: exp.createdByUser.id,
              fullName: exp.createdByUser.fullName,
              email: exp.createdByUser.email,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("EXPENSES_GET_ERROR", error);
    return NextResponse.json(
      { error: "No se pudieron cargar los gastos." },
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

    const dateRaw = String(body?.date || "").trim();
    const category = String(body?.category || "").trim();
    const countryInput = String(body?.country || "").trim();
    const currency = String(body?.currency || "").trim().toUpperCase();
    const amountStr = toDecimalString(body?.amount);
    const note = String(body?.note || "").trim();

    if (!dateRaw) {
      return NextResponse.json({ error: "La fecha es obligatoria." }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "La categoría es obligatoria." }, { status: 400 });
    }
    if (!countryInput) {
      return NextResponse.json({ error: "El país es obligatorio." }, { status: 400 });
    }
    if (!currency) {
      return NextResponse.json({ error: "La moneda es obligatoria." }, { status: 400 });
    }
    if (!amountStr || Number(amountStr) <= 0) {
      return NextResponse.json({ error: "El monto debe ser mayor a 0." }, { status: 400 });
    }

    const country = await resolveCountryByNameOrCode(countryInput);

    if (!country) {
      return NextResponse.json({ error: "No se encontró el país indicado." }, { status: 404 });
    }

    const expenseDate = new Date(dateRaw);
    if (Number.isNaN(expenseDate.getTime())) {
      return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          tenantId: session.tenantId!,
          expenseDate,
          category,
          countryId: country.id,
          currencyCode: currency,
          amount: amountStr,
          note: note || null,
          createdByUserId: session.userId ?? null,
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

      await tx.balanceMovement.create({
        data: {
          tenantId: session.tenantId!,
          countryId: country.id,
          currencyCode: currency,
          direction: BalanceMovementDirection.salida,
          movementType: BalanceMovementType.gasto,
          amount: amountStr,
          note: `Gasto: ${category}${note ? " · " + note : ""}`,
        },
      });

      return expense;
    });

    return NextResponse.json({
      ok: true,
      expense: {
        id: created.id,
        date: created.expenseDate,
        category: created.category,
        country: created.country.name,
        countryCode: created.country.code,
        currency: created.currencyCode,
        amount: Number(created.amount),
        note: created.note || "",
        createdAt: created.createdAt,
      },
    });
  } catch (error) {
    console.error("EXPENSES_POST_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo guardar el gasto." },
      { status: 500 }
    );
  }
}
