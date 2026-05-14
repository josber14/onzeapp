import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

// ============================================================
// GET /api/rate-lists
// Trae las listas de tasas según el rol del usuario:
//   - super_admin_global → todas
//   - super_admin_cliente → todas las de su tenant
//   - operador → solo las suyas
// ============================================================
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    // Crea tu tasa del día es privado por usuario:
    // cada persona ve solo sus propias listas, incluso si es admin.
    let whereClause: {
      active?: boolean;
      tenantId?: number;
      ownerUserId?: number;
    } = {
      active: true,
      ownerUserId: session.userId,
    };

    if (session.tenantId != null) {
      whereClause.tenantId = session.tenantId;
    }

    const rateLists = await prisma.rateList.findMany({
      where: whereClause,
      orderBy: { updatedAt: "desc" },
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

    return NextResponse.json({ rateLists });
  } catch (error) {
    console.error("GET /api/rate-lists error:", error);
    return NextResponse.json(
      { error: "Error al obtener listas de tasas" },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/rate-lists
// Crea una nueva lista vacía
// Body esperado: { name: string, defaultProfitPct?: number, notes?: string }
// ============================================================
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (session.tenantId == null) {
    return NextResponse.json(
      { error: "El usuario no pertenece a ningún tenant" },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    const defaultProfitPct = Number(body?.defaultProfitPct);
    const notes = body?.notes ? String(body.notes).trim() : null;

    if (!name) {
      return NextResponse.json(
        { error: "El nombre de la lista es obligatorio" },
        { status: 400 }
      );
    }

    const safeProfit =
      Number.isFinite(defaultProfitPct) && defaultProfitPct >= 0
        ? defaultProfitPct
        : 0;

    const rateList = await prisma.rateList.create({
      data: {
        tenantId: session.tenantId,
        ownerUserId: session.userId,
        name,
        defaultProfitPct: String(safeProfit),
        notes,
      },
      include: {
        pairs: true,
        ownerUser: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    return NextResponse.json({ rateList }, { status: 201 });
  } catch (error) {
    console.error("POST /api/rate-lists error:", error);
    return NextResponse.json(
      { error: "Error al crear lista de tasas" },
      { status: 500 }
    );
  }
}
