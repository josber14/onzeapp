import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

const REQUIRED_KYC_FIELDS = [
  "rut", "nacionalidad", "profesion", "actividadGiro", "domicilio", "telefono",
  "tipoCuenta", "numeroCuenta", "montoMensualEsperado",
  "origenFondos", "declaracionPep", "declaracionUsPerson",
];

// Registro público de un cliente que quiere comprar USDT al mayor — incluye
// el formulario legal de KYC/AML de Zinple SpA completo (ley 19.913), no un
// registro simplificado. multipart/form-data porque incluye la selfie con
// cédula (archivo). Al enviar el KYC completo en el mismo paso no existe un
// estado "pending_kyc" separado — pasa directo a "pending_approval".
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const tenantId = Number(form.get("tenantId"));
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const fullName = String(form.get("fullName") || "").trim();
    const kycDataRaw = String(form.get("kycData") || "{}");
    const selfie = form.get("selfie");

    if (!tenantId) return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "Correo inválido" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    if (!fullName) return NextResponse.json({ ok: false, error: "Ingresa tu nombre completo" }, { status: 400 });
    if (!(selfie instanceof File) || selfie.size === 0) {
      return NextResponse.json({ ok: false, error: "Sube la selfie sosteniendo tu documento de identidad" }, { status: 400 });
    }

    let kycData: Record<string, any>;
    try {
      kycData = JSON.parse(kycDataRaw);
    } catch {
      return NextResponse.json({ ok: false, error: "Datos de KYC inválidos" }, { status: 400 });
    }

    for (const field of REQUIRED_KYC_FIELDS) {
      if (!kycData[field]) {
        return NextResponse.json({ ok: false, error: `Falta el campo requerido: ${field}` }, { status: 400 });
      }
    }
    if (kycData.dineroEsPropio === false && !kycData.duenoReal?.nombre) {
      return NextResponse.json({ ok: false, error: "Faltan los datos del dueño real de los fondos" }, { status: 400 });
    }
    if (!kycData.aceptaTerminos) {
      return NextResponse.json({ ok: false, error: "Debes aceptar los términos y condiciones" }, { status: 400 });
    }

    const existing = await prisma.usdtClient.findUnique({ where: { tenantId_email: { tenantId, email } } });
    if (existing) {
      return NextResponse.json({ ok: false, error: "Ya existe una cuenta con ese correo" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Selfie en blob PRIVADO — requiere el token de Vercel Blob para poder
    // subirla (BLOB_READ_WRITE_TOKEN en .env.local / variables de Vercel).
    const safeEmail = email.replace(/[^a-z0-9@._-]/gi, "_");
    const blob = await put(`usdt-kyc/${tenantId}/${safeEmail}-${Date.now()}-selfie`, selfie, {
      access: "private",
      addRandomSuffix: true,
    });

    const client = await prisma.usdtClient.create({
      data: {
        tenantId,
        email,
        passwordHash,
        fullName,
        status: "pending_approval",
        kycData: { ...kycData, selfieUrl: blob.url },
      },
    });

    return NextResponse.json({ ok: true, clientId: client.id, status: client.status });
  } catch (error: any) {
    console.error("[usdt-client/register]", error?.message);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
