import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);

  if (!session) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  if (
    session.role !== "super_admin_global" &&
    session.role !== "super_admin_cliente"
  ) {
    return {
      error: NextResponse.json(
        { error: "No tienes permisos para gestionar la configuración del tenant." },
        { status: 403 }
      ),
    };
  }

  return { session };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { session } = auth;

    if (!session.tenantId && session.role !== "super_admin_global") {
      return NextResponse.json(
        { error: "Tu cuenta no tiene tenant asignado." },
        { status: 400 }
      );
    }

    const tenantId = session.tenantId;

    if (!tenantId) {
      return NextResponse.json(
        { error: "Selecciona un tenant desde una ruta global específica más adelante." },
        { status: 400 }
      );
    }

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        inviteCode: true,
        whatsappClosingNumber: true,
        sheetUrl: true,
        allowInternalOperatorManagement: true,
        allowPairCreation: true,
        allowCountryCreation: true,
        allowSheetSync: true,
        allowUsdtAnalysis: true,
        allowKyc: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      settings: settings || null,
    });
  } catch (error) {
    console.error("ADMIN_TENANT_SETTINGS_GET_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo cargar la configuración del tenant." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { session } = auth;

    if (!session.tenantId) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene tenant asignado." },
        { status: 400 }
      );
    }

    const body = await request.json();

    const inviteCode =
      typeof body.inviteCode === "string" && body.inviteCode.trim()
        ? body.inviteCode.trim()
        : null;

    const whatsappClosingNumber =
      typeof body.whatsappClosingNumber === "string" && body.whatsappClosingNumber.trim()
        ? body.whatsappClosingNumber.trim()
        : null;

    const sheetUrl =
      typeof body.sheetUrl === "string" && body.sheetUrl.trim()
        ? body.sheetUrl.trim()
        : null;

    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId: session.tenantId },
      update: {
        inviteCode,
        whatsappClosingNumber,
        sheetUrl,
      },
      create: {
        tenantId: session.tenantId,
        inviteCode,
        whatsappClosingNumber,
        sheetUrl,
      },
      select: {
        id: true,
        tenantId: true,
        inviteCode: true,
        whatsappClosingNumber: true,
        sheetUrl: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      settings,
    });
  } catch (error) {
    console.error("ADMIN_TENANT_SETTINGS_POST_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo guardar la configuración del tenant." },
      { status: 500 }
    );
  }
}
