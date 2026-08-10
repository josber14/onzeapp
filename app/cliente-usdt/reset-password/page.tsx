"use client";

import { useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/password-input";

const TENANT_ID = 1;

export default function ClienteUsdtResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setSuccess(false);

    try {
      const res = await fetch("/api/usdt-client/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "No se pudo restablecer la contraseña.");
        return;
      }
      setMessage(data.message || "Contraseña actualizada correctamente.");
      setSuccess(true);
      setEmail("");
      setCode("");
      setNewPassword("");
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
        <h1 className="mb-2 text-xl font-bold">Restablecer contraseña</h1>
        <p className="mb-6 text-sm text-slate-400">
          Escribe tu correo, el código recibido y tu nueva contraseña.
        </p>

        <label className="mb-3 block text-sm">
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

        <label className="mb-3 block text-sm">
          Código
          <input
            type="text"
            placeholder="123456"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-400"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>

        <label className="mb-4 block text-sm">
          Nueva contraseña
          <PasswordInput
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 pr-11 outline-none focus:border-emerald-400"
            iconClassName="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Guardando..." : "Actualizar contraseña"}
        </button>

        {message && (
          <p className={`mt-4 text-center text-sm ${success ? "text-emerald-400" : "text-rose-400"}`}>{message}</p>
        )}
      </form>
    </main>
  );
}
