"use client";

import Link from "next/link";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo iniciar sesión.");
        return;
      }

      if (
        data.user?.role === "super_admin_global" ||
        data.user?.role === "super_admin_cliente"
      ) {
        window.location.href = "/admin";
        return;
      }

      window.location.href = "/dashboard";
    } catch {
      setMessage("Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <h1 className="text-center text-2xl font-bold text-gray-900">
          Iniciar sesión
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Ingresa a tu cuenta ONZE
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Correo
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <div className="text-right">
            <a
              href="/forgot-password"
              className="text-sm font-medium text-green-700 hover:text-green-800"
            >
              Olvidé mi contraseña
            </a>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-red-600">{message}</p>
        )}

        <p className="mt-6 text-center text-sm text-gray-600">
          ¿No tienes cuenta?{" "}
          <Link
            href="/register"
            className="font-semibold text-green-700 hover:text-green-800"
          >
            Regístrate
          </Link>
        </p>
      </div>
    </main>
  );
}
