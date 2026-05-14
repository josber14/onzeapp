import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken, type SessionPayload } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// Verifica si el usuario puede acceder a una lista determinada
function canAccessList(
  session: SessionPayload,
  rateList: { tenantId: number; ownerUserId: number }
): boolean {
  // Crea tu tasa del día es privado por usuario:
  // cada persona abre/edita/elimina solo sus propias listas.
  return session.userId === rateList.ownerUserId;
}

// Parsea el ID desde la URL params
async function parseId(
  context: { params: Promise<{ id: string }> } | { params: { id: string } }
): Promise<number | null> {
  const params = await Promise.resolve(
    (context as { params: Promise<{ id: string }> }).params
  );
  const idNum = Number(params?.id);
  return Number.isFinite(idNum) && idNum > 0 ? idNum : null;
}

// ============================================================
// GET /api/rate-lists/[id]
// Trae una lista específica con todos sus pares
// ============================================================
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const id = await parseId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const rateList = await prisma.rateList.findUnique({
      where: { id },
      include: {
        pairs: {
          orderBy: { sortOrder: "asc" },
          include: {
            originCountry: {
              select: { id: true, code: true, name: true, currencyCode: true },
            },
            destinationCountry: {
              select: { id: true, code: true, name: true, currencyCode: true },
            },
          },
        },
        ownerUser: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!rateList) {
      return NextResponse.json({ error: "Lista no encontrada" }, { status: 404 });
    }

    if (!canAccessList(session, rateList)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    return NextResponse.json({ rateList });
  } catch (error) {
    console.error("GET /api/rate-lists/[id] error:", error);
    return NextResponse.json(
      { error: "Error al obtener lista" },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT /api/rate-lists/[id]
// Edita la lista completa: nombre, % global, notas, y pares
// Body:
// {
//   name?: string,
//   defaultProfitPct?: number,
//   notes?: string,
//   pairs?: [
//     { originCountryId, destinationCountryId, customProfitPct?, sortOrder? }
//   ]
// }
// Si se envía pairs → reemplaza completamente los pares
// ============================================================
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const id = await parseId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const existing = await prisma.rateList.findUnique({
      where: { id },
      select: { id: true, tenantId: true, ownerUserId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Lista no encontrada" }, { status: 404 });
    }

    if (!canAccessList(session, existing)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const body = await req.json();

    // Datos generales (opcionales)
    const updateData: {
      name?: string;
      defaultProfitPct?: string;
      notes?: string | null;
    } = {};

    if (typeof body?.name === "string" && body.name.trim()) {
      updateData.name = body.name.trim();
    }
    if (body?.defaultProfitPct !== undefined) {
      const n = Number(body.defaultProfitPct);
      if (Number.isFinite(n) && n >= 0) {
        updateData.defaultProfitPct = String(n);
      }
    }
    if (body?.notes !== undefined) {
      updateData.notes = body.notes ? String(body.notes).trim() : null;
    }

    // Si se envían pairs, reemplazamos todos los pares
    const replacePairs = Array.isArray(body?.pairs);

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Actualizar la lista
      if (Object.keys(updateData).length > 0) {
        await tx.rateList.update({
          where: { id },
          data: updateData,
        });
      }

      // 2. Si hay nuevos pares, borrar los anteriores y crear los nuevos
      if (replacePairs) {
        await tx.rateListPair.deleteMany({ where: { rateListId: id } });

        const pairsInput = body.pairs as Array<{
          originCountryId: number;
          destinationCountryId: number;
          customProfitPct?: number | null;
          sortOrder?: number;
        }>;

        const pairsToCreate = pairsInput
          .filter(
            (p) =>
              Number.isFinite(Number(p.originCountryId)) &&
              Number.isFinite(Number(p.destinationCountryId))
          )
          .map((p, idx) => ({
            rateListId: id,
            originCountryId: Number(p.originCountryId),
            destinationCountryId: Number(p.destinationCountryId),
            customProfitPct:
              p.customProfitPct != null && Number.isFinite(Number(p.customProfitPct))
                ? String(Number(p.customProfitPct))
                : null,
            sortOrder: Number.isFinite(Number(p.sortOrder))
              ? Number(p.sortOrder)
              : idx,
          }));

        // Evitar duplicados: dedupe por (origin, destination)
        const seen = new Set<string>();
        const uniquePairs = pairsToCreate.filter((p) => {
          const key = `${p.originCountryId}-${p.destinationCountryId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (uniquePairs.length > 0) {
          await tx.rateListPair.createMany({ data: uniquePairs });
        }
      }

      // 3. Devolver la lista actualizada completa
      return tx.rateList.findUnique({
        where: { id },
        include: {
          pairs: {
            orderBy: { sortOrder: "asc" },
            include: {
              originCountry: {
                select: { id: true, code: true, name: true, currencyCode: true },
              },
              destinationCountry: {
                select: { id: true, code: true, name: true, currencyCode: true },
              },
            },
          },
          ownerUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });
    });

    return NextResponse.json({ rateList: updated });
  } catch (error) {
    console.error("PUT /api/rate-lists/[id] error:", error);
    return NextResponse.json(
      { error: "Error al actualizar lista" },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/rate-lists/[id]
// Marca la lista como inactiva (soft delete) para mantener auditoría
// ============================================================
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const id = await parseId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const existing = await prisma.rateList.findUnique({
      where: { id },
      select: { id: true, tenantId: true, ownerUserId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Lista no encontrada" }, { status: 404 });
    }

    if (!canAccessList(session, existing)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    await prisma.rateList.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rate-lists/[id] error:", error);
    return NextResponse.json(
      { error: "Error al eliminar lista" },
      { status: 500 }
    );
  }
}
