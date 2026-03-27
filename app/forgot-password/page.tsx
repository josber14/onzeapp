"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("Pronto activaremos la recuperación de contraseña. Por ahora, contáctanos para restablecer tu acceso.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <h1 className="text-center text-2xl font-bold text-gray-900">
          Recuperar contraseña
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Ingresa tu correo y te guiaremos para recuperar el acceso.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Correo
            </label>
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-green-700 py-3 text-base font-semibold text-white transition hover:bg-green-800"
          >
            Continuar
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-gray-700">{message}</p>
        )}

        <p className="mt-6 text-center text-sm text-gray-600">
          <Link
            href="/login"
            className="font-semibold text-green-700 hover:text-green-800"
          >
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
