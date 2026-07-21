"use client";

import { useState } from "react";

const TENANT_ID = 1;

export default function ClienteUsdtLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/usdt-client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.status && data.status !== "approved") {
          window.location.href = "/cliente-usdt/pendiente";
          return;
        }
        setMessage(data.error || "No se pudo iniciar sesión.");
        return;
      }
      window.location.href = "/cliente-usdt/billetera";
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
        <h1 className="mb-6 text-xl font-bold">Iniciar sesión</h1>

        <label className="mb-3 block text-sm">
          Correo
          <input
            type="email"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="mb-4 block text-sm">
          Contraseña
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {message && <p className="mb-4 text-sm text-rose-400">{message}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          ¿No tienes cuenta?{" "}
          <a href="/cliente-usdt/registro" className="text-emerald-400 hover:underline">
            Regístrate
          </a>
        </p>
      </form>
    </main>
  );
}
