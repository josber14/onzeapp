import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

function getErrorInfo(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    };
  }

  return {
    raw: String(error),
  };
}

export async function POST(req: Request) {
  try {
    await prisma.$connect();

    const body = await req.json();

    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const phone = String(body.phone || "").trim();
    const residenceCountryCode = String(
      body.residenceCountryCode || ""
    ).trim();

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "Nombre, correo y contraseña son obligatorios." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 6 caracteres." },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Ese correo ya está registrado." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        phone: phone || null,
        residenceCountryCode: residenceCountryCode || null,
        role: "operador",
        status: "pendiente",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Cuenta creada correctamente.",
      user,
    });
  } catch (error) {
    console.error("REGISTER_ERROR_DETAILED", getErrorInfo(error));

    return NextResponse.json(
      { error: "Ocurrió un error inesperado." },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}