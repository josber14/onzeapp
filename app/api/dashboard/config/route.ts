import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value || null;
    const session = verifySessionToken(token);

    if (!session) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    if (!session.tenantId) {
      return NextResponse.json({
        ok: true,
        config: {
          tenantId: null,
          sheetUrl: null,
          whatsappClosingNumber: null,
          inviteCode: null,
        },
      });
    }

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: {
        tenantId: true,
        sheetUrl: true,
        whatsappClosingNumber: true,
        inviteCode: true,
      },
    });

    return NextResponse.json({
      ok: true,
      config: {
        tenantId: session.tenantId,
        sheetUrl: settings?.sheetUrl || null,
        whatsappClosingNumber: settings?.whatsappClosingNumber || null,
        inviteCode: settings?.inviteCode || null,
      },
    });
  } catch (error) {
    console.error("DASHBOARD_CONFIG_GET_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo cargar la configuración del dashboard." },
      { status: 500 }
    );
  }
}
