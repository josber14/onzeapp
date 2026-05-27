import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value;
  return verifySessionToken(token);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const accounts = await prisma.p2PAccount.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { sortOrder: "asc" },
    });

    return Response.json({
      ok: true,
      accounts: accounts.map(a => ({
        id: a.id,
        exchange: a.exchange,
        label: a.label,
        accountType: a.accountType,
        accountInfo: a.accountInfo,
        isActive: a.isActive,
        sortOrder: a.sortOrder,
      })),
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { id, exchange, label, accountType, accountInfo, isActive, sortOrder } = body;

    if (id) {
      const updated = await prisma.p2PAccount.update({
        where: { id, tenantId: session.tenantId },
        data: {
          ...(exchange !== undefined && { exchange }),
          ...(label !== undefined && { label }),
          ...(accountType !== undefined && { accountType }),
          ...(accountInfo !== undefined && { accountInfo }),
          ...(isActive !== undefined && { isActive }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      return Response.json({ ok: true, account: updated });
    }

    if (!exchange || !label) {
      return Response.json({ ok: false, error: "exchange y label son requeridos" }, { status: 400 });
    }

    const created = await prisma.p2PAccount.create({
      data: {
        tenantId: session.tenantId,
        exchange,
        label,
        accountType: accountType || "bank",
        accountInfo: accountInfo || {},
        isActive: isActive !== undefined ? isActive : true,
        sortOrder: sortOrder || 0,
        updatedAt: new Date(),
      },
    });

    return Response.json({ ok: true, account: created });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return Response.json({ ok: false, error: "id requerido" }, { status: 400 });
    }

    await prisma.p2PAccount.deleteMany({
      where: { id, tenantId: session.tenantId },
    });

    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
