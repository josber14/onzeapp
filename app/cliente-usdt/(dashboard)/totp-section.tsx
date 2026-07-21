"use client";

import { useEffect, useState } from "react";

export default function TotpSection() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/usdt-client/2fa/status")
      .then((r) => r.json())
      .then((data) => setEnabled(!!data.enabled))
      .finally(() => setLoading(false));
  }, []);

  async function startSetup() {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/usdt-client/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo iniciar la configuración");
        return;
      }
      setSetupData({ secret: data.secret, qrDataUrl: data.qrDataUrl });
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/usdt-client/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo confirmar");
        return;
      }
      setEnabled(true);
      setSetupData(null);
      setCode("");
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/usdt-client/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo desactivar");
        return;
      }
      setEnabled(false);
      setCode("");
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Cargando…</div>;
  }

  if (enabled) {
    return (
      <div>
        <p className="mb-4 text-sm text-emerald-400">✅ El 2FA está activado. Lo necesitarás cada vez que retires USDT.</p>
        <form onSubmit={handleDisable}>
          <label className="mb-1 block text-xs text-slate-400">Código de tu app de autenticación (para desactivar)</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mb-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-rose-400"
          />
          {message && <p className="mb-3 text-sm text-rose-400">{message}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-lg border border-rose-400/40 py-2 text-sm font-semibold text-rose-400 transition hover:bg-rose-400/10 disabled:opacity-50"
          >
            Desactivar 2FA
          </button>
        </form>
      </div>
    );
  }

  if (setupData) {
    return (
      <div className="text-center">
        <p className="mb-4 text-sm text-slate-300">
          Escanea este código con Google Authenticator (o cualquier app de autenticación) y luego escribe el código de 6 dígitos que te muestre.
        </p>
        <img src={setupData.qrDataUrl} alt="Código QR 2FA" className="mx-auto mb-3 h-48 w-48 rounded-lg bg-white p-2" />
        <p className="mb-4 break-all text-xs text-slate-500">
          ¿No puedes escanear? Escribe este código manualmente: <span className="font-mono text-slate-300">{setupData.secret}</span>
        </p>
        <form onSubmit={confirmSetup}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mb-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-emerald-400"
          />
          {message && <p className="mb-3 text-sm text-rose-400">{message}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            Confirmar y activar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="mb-4 text-sm text-slate-300">
        El 2FA protege tus retiros de USDT. Actívalo con una app de autenticación como Google Authenticator.
      </p>
      {message && <p className="mb-3 text-sm text-rose-400">{message}</p>}
      <button
        onClick={startSetup}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
      >
        Activar 2FA
      </button>
    </div>
  );
}
