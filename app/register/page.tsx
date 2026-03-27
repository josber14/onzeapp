"use client";

import Link from "next/link";
import { useState } from "react";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setSuccess(false);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          password,
          phone,
          residenceCountryCode: country,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Ocurrió un error inesperado.");
        setSuccess(false);
        return;
      }

      setMessage("Cuenta creada con éxito. Ahora puedes iniciar sesión.");
      setSuccess(true);

      setFullName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setCountry("");
    } catch {
      setMessage("Ocurrió un error inesperado.");
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg md:max-w-lg md:p-8">
        <h1 className="text-center text-2xl font-bold text-gray-900 md:text-3xl">
          Crear cuenta
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500 md:text-base">
          Regístrate para acceder a ONZE
        </p>

        <form onSubmit={handleRegister} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre completo
            </label>
            <input
              type="text"
              placeholder="Tu nombre completo"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-black placeholder:text-gray-400 outline-none transition focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Correo
            </label>
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-black placeholder:text-gray-400 outline-none transition focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contraseña
            </label>
            <input
              type="password"
              placeholder="********"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-black placeholder:text-gray-400 outline-none transition focus:ring-2 focus:ring-green-600"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Teléfono
            </label>
            <input
              type="text"
              placeholder="+56 9..."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-black placeholder:text-gray-400 outline-none transition focus:ring-2 focus:ring-green-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              País de residencia
            </label>
            <input
              type="text"
              placeholder="CL"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-black placeholder:text-gray-400 outline-none transition focus:ring-2 focus:ring-green-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-green-700 py-3 text-base font-semibold text-white transition hover:bg-green-800 disabled:opacity-70"
          >
            {loading ? "Registrando..." : "Registrarme"}
          </button>
        </form>

        {message ? (
          <div className="mt-5 text-center">
            <p className={`text-sm ${success ? "text-gray-700" : "text-red-600"}`}>
              {message}
            </p>

            {success ? (
              <Link
                href="/login"
                className="mt-4 inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition hover:bg-gray-100"
              >
                Ir a iniciar sesión
              </Link>
            ) : null}
          </div>
        ) : null}

        <p className="mt-6 text-center text-sm text-gray-600">
          ¿Ya tienes cuenta?{" "}
          <Link
            href="/login"
            className="font-semibold text-green-700 hover:text-green-800"
          >
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
