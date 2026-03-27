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
    <main className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4 py-10">
      <div className="w-full max-w-3xl rounded-[28px] bg-white p-8 shadow-lg md:p-12">
        <h1 className="text-center text-4xl font-bold text-slate-900">
          Crear cuenta
        </h1>
        <p className="mt-4 text-center text-2xl text-slate-500">
          Regístrate para acceder a ONZE
        </p>

        <form onSubmit={handleRegister} className="mt-12 space-y-8">
          <div>
            <label className="mb-3 block text-2xl text-slate-700">
              Nombre completo
            </label>
            <input
              type="text"
              placeholder="Tu nombre completo"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-[22px] border border-slate-300 px-8 py-6 text-2xl outline-none transition focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-3 block text-2xl text-slate-700">Correo</label>
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[22px] border border-slate-300 px-8 py-6 text-2xl outline-none transition focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-3 block text-2xl text-slate-700">
              Contraseña
            </label>
            <input
              type="password"
              placeholder="********"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[22px] border border-slate-300 px-8 py-6 text-2xl outline-none transition focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-3 block text-2xl text-slate-700">
              Teléfono
            </label>
            <input
              type="text"
              placeholder="+56 9..."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-[22px] border border-slate-300 px-8 py-6 text-2xl outline-none transition focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-3 block text-2xl text-slate-700">
              País de residencia
            </label>
            <input
              type="text"
              placeholder="CL"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-[22px] border border-slate-300 px-8 py-6 text-2xl outline-none transition focus:border-slate-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[22px] bg-[#0a8f3c] px-8 py-6 text-3xl font-bold text-white transition hover:bg-[#087a33] disabled:opacity-70"
          >
            {loading ? "Registrando..." : "Registrarme"}
          </button>
        </form>

        {message ? (
          <div className="mt-8 text-center">
            <p
              className={`text-2xl ${
                success ? "text-slate-700" : "text-red-600"
              }`}
            >
              {message}
            </p>

            {success ? (
              <Link
                href="/login"
                className="mt-6 inline-flex items-center justify-center rounded-[18px] border border-slate-300 bg-white px-8 py-4 text-xl font-semibold text-slate-800 transition hover:bg-slate-100"
              >
                Ir a iniciar sesión
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}