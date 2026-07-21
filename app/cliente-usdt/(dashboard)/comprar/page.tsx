"use client";

import { useEffect, useRef, useState } from "react";

type Quote = {
  clpAmount: number;
  rate: number;
  usdtAmount: number;
  marginPct: number;
};

const REFRESH_SECONDS = 5;

export default function ComprarPage() {
  const [clpInput, setClpInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopTicking() {
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    refreshIntervalRef.current = null;
    countdownIntervalRef.current = null;
  }

  async function fetchQuote(clpAmount: number) {
    try {
      const res = await fetch("/api/usdt-client/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clpAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "No se pudo cotizar");
        setQuote(null);
        stopTicking();
        return;
      }
      setError("");
      setQuote(data.quote);
      setCountdown(REFRESH_SECONDS);
    } catch {
      setError("Ocurrió un error inesperado");
    }
  }

  function startTicking(clpAmount: number) {
    stopTicking();
    fetchQuote(clpAmount);
    refreshIntervalRef.current = setInterval(() => fetchQuote(clpAmount), REFRESH_SECONDS * 1000);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_SECONDS : c - 1));
    }, 1000);
  }

  // Cotiza en vivo mientras el cliente escribe (con un pequeño debounce) y
  // se refresca sola cada 5s — mismo ritmo que la propia pantalla de Skipo,
  // para que la experiencia se sienta igual de "en vivo".
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const amount = Number(clpInput);
    if (!clpInput || !(amount >= 500)) {
      stopTicking();
      setQuote(null);
      setError("");
      return;
    }
    debounceRef.current = setTimeout(() => startTicking(amount), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clpInput]);

  useEffect(() => () => stopTicking(), []);

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-base font-semibold">Comprar USDT</h2>

        <label className="mb-1 block text-xs text-slate-400">Pagas (CLP)</label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="Ej: 100.000"
          value={clpInput ? Number(clpInput).toLocaleString("es-CL") : ""}
          onChange={(e) => setClpInput(e.target.value.replace(/\D/g, ""))}
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-lg outline-none focus:border-emerald-400"
        />

        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

        <label className="mb-1 block text-xs text-slate-400">Recibes</label>
        <div className="flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-4">
          <div className="text-2xl font-bold text-emerald-400">
            {quote ? quote.usdtAmount.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"} USDT
          </div>
        </div>
        {quote && (
          <div className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-200">
            <span>
              Precio: <span className="font-semibold text-slate-50">{quote.rate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> CLP/USDT
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-400 text-xs font-bold text-amber-400">
              {countdown}
            </span>
          </div>
        )}

        <button
          disabled
          title="Próximamente"
          className="mt-5 w-full rounded-lg bg-slate-700 py-3 font-semibold text-slate-400 cursor-not-allowed"
        >
          Comprar (próximamente)
        </button>
      </div>
    </div>
  );
}
