import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("onze_session")?.value || null;
    const session = verifySessionToken(token);

    if (!session) {
      return NextResponse.json(
        { error: "No autenticado." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        role: session.role,
      },
    });
  } catch (error) {
    console.error("AUTH_ME_ERROR", error);

    return NextResponse.json(
      { error: "No se pudo validar la sesión." },
      { status: 500 }
    );
  }
}