"use client";

import { useState } from "react";
import Link from "next/link";

const TENANT_ID = 1;

export default function ClienteUsdtForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setSubmitted(false);

    try {
      const res = await fetch("/api/usdt-client/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "No se pudo procesar la solicitud.");
        return;
      }
      setMessage(data.message || "Si el correo existe, te enviaremos un código para restablecer tu contraseña.");
      setSubmitted(true);
    } catch {
      setMessage("Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#041126] px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-slate-100"
      >
        <Link href="/cliente-usdt/login" className="mb-6 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Volver a iniciar sesión
        </Link>
        <h1 className="mb-2 text-xl font-bold">Recuperar contraseña</h1>
        <p className="mb-6 text-sm text-slate-400">
          Ingresa tu correo y te enviaremos un código para recuperar el acceso.
        </p>

        <label className="mb-4 block text-sm">
          Correo
          <input
            type="email"
            placeholder="correo@ejemplo.com"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Enviando..." : "Continuar"}
        </button>

        {message && (
          <div className="mt-4 text-center">
            <p className="text-sm text-slate-300">{message}</p>
            {submitted && (
              <Link
                href="/cliente-usdt/reset-password"
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-white/10 bg-black/30 px-5 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Ya tengo el código
              </Link>
            )}
          </div>
        )}
      </form>
    </main>
  );
}
