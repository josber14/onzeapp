import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { BalanceMovementType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const expenseId = Number(id);

    console.log("EXPENSE_DELETE_DEBUG", {
      rawId: id,
      parsedId: expenseId,
      tenantId: session?.tenantId,
      userId: session?.userId || null
    });

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const existing = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        tenantId: session.tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        category: true,
        note: true,
        amount: true,
        countryId: true,
        currencyCode: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.expense.delete({
        where: { id: existing.id },
      });

      await tx.balanceMovement.deleteMany({
        where: {
          tenantId: session.tenantId!,
          countryId: existing.countryId,
          currencyCode: existing.currencyCode,
          movementType: BalanceMovementType.gasto,
          amount: existing.amount,
          note: `Gasto: ${existing.category}${existing.note ? " · " + existing.note : ""}`,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("EXPENSE_DELETE_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo eliminar el gasto." },
      { status: 500 }
    );
  }
}
