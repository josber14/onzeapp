"use client";

import Link from "next/link";
import { useState } from "react";
import PasswordInput from "@/components/password-input";

type Step = "email" | "choose" | "password";
type AccountType = "operador" | "usdt";

const CARD_CLASS =
  "rounded-[32px] border border-white/10 bg-white/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur md:p-8";
const INPUT_CLASS =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [usdtTenantId, setUsdtTenantId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/account-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage("No se pudo verificar el correo.");
        return;
      }
      if (!data.hasOperator && !data.hasUsdtClient) {
        setMessage("No existe una cuenta con ese correo.");
        return;
      }
      setUsdtTenantId(data.usdtTenantId);
      if (data.hasOperator && data.hasUsdtClient) {
        setStep("choose");
      } else {
        setAccountType(data.hasOperator ? "operador" : "usdt");
        setStep("password");
      }
    } catch {
      setMessage("Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  function chooseType(type: AccountType) {
    setAccountType(type);
    setMessage("");
    setStep("password");
  }

  function backToEmail() {
    setStep("email");
    setPassword("");
    setAccountType(null);
    setMessage("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      if (accountType === "operador") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error || "No se pudo iniciar sesión.");
          return;
        }
        if (data.user?.role === "super_admin_global" || data.user?.role === "super_admin_cliente") {
          window.location.href = "/admin";
          return;
        }
        window.location.href = "/dashboard";
      } else {
        const res = await fetch("/api/usdt-client/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, tenantId: usdtTenantId }),
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
      }
    } catch {
      setMessage("Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#041126_0%,#071a39_48%,#0a1f45_100%)] px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_24%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.10),transparent_22%),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,120px_120px,120px_120px]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(4,17,38,0.92)_0%,rgba(4,17,38,0.82)_45%,rgba(4,17,38,0.68)_100%)]" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-6 py-3 text-center backdrop-blur"
          >
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">ZINPLE</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Tecnología • Operación • Control
              </div>
            </div>
          </Link>
        </div>

        <div className={CARD_CLASS}>
          {step === "email" && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Iniciar sesión</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">Ingresa a tu cuenta ZINPLE</p>
              </div>

              <form onSubmit={handleContinue} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Correo</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className={INPUT_CLASS}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-[#0a8f3c] py-3.5 font-semibold text-white shadow-[0_10px_24px_rgba(10,143,60,0.28)] transition hover:bg-[#087a33] disabled:opacity-60"
                >
                  {loading ? "Verificando..." : "Continuar"}
                </button>
              </form>

              {message && (
                <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
                  {message}
                </p>
              )}

              <p className="mt-6 text-center text-sm text-slate-600">
                ¿No tienes cuenta?{" "}
                <Link href="/register" className="font-semibold text-emerald-700 transition hover:text-emerald-800">
                  Regístrate
                </Link>
              </p>
            </>
          )}

          {step === "choose" && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">¿Con qué cuenta quieres entrar?</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {email} tiene dos tipos de cuenta en ZINPLE.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => chooseType("operador")}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
                >
                  <div className="font-semibold text-slate-900">Operador</div>
                  <div className="text-sm text-slate-500">Trabajas con nosotros operando la plataforma.</div>
                </button>
                <button
                  type="button"
                  onClick={() => chooseType("usdt")}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
                >
                  <div className="font-semibold text-slate-900">Activos Digitales</div>
                  <div className="text-sm text-slate-500">Compras USDT directo, con precio en vivo.</div>
                </button>
              </div>

              <button
                type="button"
                onClick={backToEmail}
                className="mt-6 w-full text-center text-sm font-medium text-slate-500 transition hover:text-slate-700"
              >
                ← Usar otro correo
              </button>
            </>
          )}

          {step === "password" && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {accountType === "operador" ? "Entrar como Operador" : "Entrar como Activos Digitales"}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">{email}</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Contraseña</label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="********"
                    className={`${INPUT_CLASS} pr-12`}
                    required
                    autoFocus
                  />
                </div>

                {accountType === "operador" && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Acceso seguro</div>
                    <a
                      href="/forgot-password"
                      className="text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
                    >
                      Olvidé mi contraseña
                    </a>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-[#0a8f3c] py-3.5 font-semibold text-white shadow-[0_10px_24px_rgba(10,143,60,0.28)] transition hover:bg-[#087a33] disabled:opacity-60"
                >
                  {loading ? "Entrando..." : "Iniciar sesión"}
                </button>
              </form>

              {message && (
                <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
                  {message}
                </p>
              )}

              <button
                type="button"
                onClick={backToEmail}
                className="mt-6 w-full text-center text-sm font-medium text-slate-500 transition hover:text-slate-700"
              >
                ← Usar otro correo
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
