"use client";

import Link from "next/link";
import { useState } from "react";
import PasswordInput from "@/components/password-input";

export default function RegisterPage() {
  // Antes de mostrar el formulario de operador (sin tocar nada de ese
  // flujo), se pregunta qué tipo de cuenta quiere la persona — "mayorista"
  // se manda al registro/KYC separado de clientes USDT, "operador" sigue
  // exactamente el mismo formulario de siempre.
  const [accountKind, setAccountKind] = useState<"" | "operador" | "mayorista">("");
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

      setMessage(data.message || "Cuenta creada con éxito.");
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#041126_0%,#071a39_48%,#0a1f45_100%)] px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_24%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.10),transparent_22%),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,120px_120px,120px_120px]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(4,17,38,0.92)_0%,rgba(4,17,38,0.82)_45%,rgba(4,17,38,0.68)_100%)]" />

      <div className="relative w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-6 py-3 text-center backdrop-blur"
          >
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">
                ZINPLE
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Tecnología • Operación • Control
              </div>
            </div>
          </Link>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-white/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur md:p-8">
          {accountKind === "" ? (
            <div>
              <div className="mb-6 text-center">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                  Crear cuenta
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  ¿Qué tipo de cuenta quieres crear?
                </p>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setAccountKind("operador")}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
                >
                  <div className="font-semibold text-slate-900">Operador</div>
                  <div className="text-sm text-slate-500">Trabajas con nosotros operando la plataforma.</div>
                </button>
                <button
                  type="button"
                  onClick={() => { window.location.href = "/cliente-usdt/registro"; }}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
                >
                  <div className="font-semibold text-slate-900">Activos Digitales</div>
                  <div className="text-sm text-slate-500">Obtén activos digitales con precio en vivo del mercado.</div>
                </button>
              </div>
              <p className="mt-6 text-center text-sm text-slate-600">
                ¿Ya tienes cuenta?{" "}
                <Link href="/login" className="font-semibold text-emerald-700 transition hover:text-emerald-800">
                  Inicia sesión
                </Link>
              </p>
            </div>
          ) : (
          <>
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Crear cuenta
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Regístrate para acceder a ZINPLE
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Nombre completo
              </label>
              <input
                type="text"
                placeholder="Tu nombre completo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Correo
              </label>
              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Contraseña
              </label>
              <PasswordInput
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 pr-12 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Teléfono
              </label>
              <input
                type="text"
                placeholder="+56 9..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                País de residencia
              </label>
              <input
                type="text"
                placeholder="CL"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-[#0a8f3c] py-3.5 text-base font-semibold text-white shadow-[0_10px_24px_rgba(10,143,60,0.28)] transition hover:bg-[#087a33] disabled:opacity-70"
            >
              {loading ? "Registrando..." : "Registrarme"}
            </button>
          </form>

          {message ? (
            <div className="mt-5 text-center">
              <p
                className={`rounded-2xl px-4 py-3 text-sm ${
                  success
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border border-red-200 bg-red-50 text-red-600"
                }`}
              >
                {message}
              </p>

              {success ? (
                <Link
                  href="/login"
                  className="mt-4 inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
                >
                  Ir a iniciar sesión
                </Link>
              ) : null}
            </div>
          ) : null}

          <p className="mt-6 text-center text-sm text-slate-600">
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/login"
              className="font-semibold text-emerald-700 transition hover:text-emerald-800"
            >
              Inicia sesión
            </Link>
          </p>
          </>
          )}
        </div>
      </div>
    </main>
  );
}
