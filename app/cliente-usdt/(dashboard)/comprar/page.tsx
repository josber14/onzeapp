"use client";

import { useEffect, useRef, useState } from "react";

type Quote = {
  clpAmount: number;
  rate: number;
  usdtAmount: number;
  marginPct: number;
};

type PurchaseIntent = {
  id: number;
  referenceCode: string;
  requestedClp: string | number;
  receivedClp: string | number;
  status: "awaiting_payment" | "ready_to_buy" | "executing" | "completed" | "cancelled";
  usdtAmount: string | number | null;
  executedRate: string | number | null;
};

type PaymentAccount = {
  bank: string;
  accountNumber: string;
  rut: string;
  holderName: string;
};

const REFRESH_SECONDS = 5;
const INTENT_POLL_MS = 6000;
const PRICE_HISTORY_POLL_MS = 30000;

function PriceSparkline({ ticks }: { ticks: { rate: number }[] }) {
  if (ticks.length < 2) return null;
  const rates = ticks.map((t) => t.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;
  const width = 240;
  const height = 40;
  const points = rates
    .map((r, i) => {
      const x = (i / (rates.length - 1)) * width;
      const y = height - ((r - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const trendUp = rates[rates.length - 1] >= rates[0];

  return (
    <div className="mt-3">
      <div className="mb-1 text-xs text-slate-500">Precio — últimos 10 min</div>
      <svg width={width} height={height} className="overflow-visible">
        <polyline points={points} fill="none" stroke={trendUp ? "#34d399" : "#fb7185"} strokeWidth={2} />
      </svg>
    </div>
  );
}

export default function ComprarPage() {
  const [clpInput, setClpInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [activeIntent, setActiveIntent] = useState<PurchaseIntent | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState("");
  const [priceHistory, setPriceHistory] = useState<{ rate: number; createdAt: string }[]>([]);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Cotiza en vivo mientras el cliente decide cuánto comprar — solo mientras
  // no tiene ninguna solicitud de compra en curso todavía.
  useEffect(() => {
    if (activeIntent) return;
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
  }, [clpInput, activeIntent]);

  useEffect(() => () => stopTicking(), []);

  // Historial de precio — puramente informativo, corre independiente del
  // resto (no afecta ninguna cotización real).
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/usdt-client/price-history");
        const data = await res.json();
        if (res.ok && data.ok) setPriceHistory(data.ticks);
      } catch {
        // silencioso — es solo un gráfico de referencia
      }
    }
    loadHistory();
    const id = setInterval(loadHistory, PRICE_HISTORY_POLL_MS);
    return () => clearInterval(id);
  }, []);

  function stopIntentPoll() {
    if (intentPollRef.current) clearInterval(intentPollRef.current);
    intentPollRef.current = null;
  }

  async function pollIntent(id: number) {
    try {
      const res = await fetch(`/api/usdt-client/purchase-intent/${id}`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      setActiveIntent(data.intent);
      if (data.intent.status === "completed" || data.intent.status === "cancelled") {
        stopIntentPoll();
      }
    } catch {
      // Se reintenta solo en el próximo tick — un error de red puntual no
      // debe interrumpir la espera.
    }
  }

  function startIntentPoll(id: number) {
    stopIntentPoll();
    pollIntent(id);
    intentPollRef.current = setInterval(() => pollIntent(id), INTENT_POLL_MS);
  }

  // Al entrar a la pantalla, retoma una solicitud ya en curso si existe (ej.
  // el cliente recargó la página mientras esperaba que su pago llegara).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/usdt-client/purchase-intent");
        const data = await res.json();
        if (res.ok && data.ok) {
          setPaymentAccount(data.paymentAccount);
          if (data.intents?.length > 0) {
            setActiveIntent(data.intents[0]);
            startIntentPoll(data.intents[0].id);
          }
        }
      } finally {
        setLoadingInitial(false);
      }
    })();
    return () => stopIntentPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSolicitarCompra() {
    const amount = Number(clpInput);
    if (!(amount >= 500)) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/usdt-client/purchase-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clpAmount: amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "No se pudo crear la solicitud");
        return;
      }
      stopTicking();
      setPaymentAccount(data.paymentAccount);
      setActiveIntent(data.intent);
      startIntentPoll(data.intent.id);
    } catch {
      setError("Ocurrió un error inesperado");
    } finally {
      setCreating(false);
    }
  }

  async function handleComprar() {
    if (!activeIntent) return;
    setExecuting(true);
    setExecuteError("");
    try {
      const res = await fetch(`/api/usdt-client/purchase-intent/${activeIntent.id}/execute`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setExecuteError(data.error || "No se pudo ejecutar la compra");
        return;
      }
      stopIntentPoll();
      setActiveIntent(data.intent);
    } catch {
      setExecuteError("Ocurrió un error inesperado");
    } finally {
      setExecuting(false);
    }
  }

  function handleNuevaCompra() {
    setActiveIntent(null);
    setClpInput("");
    setQuote(null);
    setExecuteError("");
  }

  if (loadingInitial) {
    return <div className="mx-auto max-w-lg text-sm text-slate-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-base font-semibold">Comprar USDT</h2>

        {!activeIntent && (
          <>
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

            <label className="mb-1 block text-xs text-slate-400">Recibes (referencial)</label>
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
            <p className="mt-2 text-xs text-slate-500">
              Este precio es solo referencial — el precio final se fija recién cuando confirmemos tu pago y aprietes "Comprar".
            </p>

            <PriceSparkline ticks={priceHistory} />

            <button
              disabled={!(Number(clpInput) >= 500) || creating}
              onClick={handleSolicitarCompra}
              className="mt-5 w-full rounded-lg bg-emerald-500 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {creating ? "Creando solicitud…" : "Solicitar compra"}
            </button>
          </>
        )}

        {activeIntent && activeIntent.status !== "completed" && (
          <div>
            <p className="mb-4 text-sm text-slate-300">
              Transfiere <span className="font-semibold text-slate-50">${Number(activeIntent.requestedClp).toLocaleString("es-CL")}</span> a
              la cuenta de abajo. En el <span className="font-semibold">comentario/glosa</span> de tu transferencia escribe este código:
            </p>

            <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-4 text-center">
              <div className="text-xs uppercase tracking-wide text-amber-300">Código de referencia</div>
              <div className="text-3xl font-black tracking-[0.3em] text-amber-300">{activeIntent.referenceCode}</div>
            </div>

            {paymentAccount && (
              <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                <div className="mb-1 flex justify-between"><span className="text-slate-400">Banco</span><span>{paymentAccount.bank}</span></div>
                <div className="mb-1 flex justify-between"><span className="text-slate-400">Cuenta</span><span>{paymentAccount.accountNumber}</span></div>
                <div className="mb-1 flex justify-between"><span className="text-slate-400">RUT</span><span>{paymentAccount.rut}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Titular</span><span>{paymentAccount.holderName}</span></div>
              </div>
            )}

            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between text-sm text-slate-300">
                <span>Recibido</span>
                <span className="font-semibold text-slate-50">
                  ${Number(activeIntent.receivedClp).toLocaleString("es-CL")} / ${Number(activeIntent.requestedClp).toLocaleString("es-CL")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, (Number(activeIntent.receivedClp) / Number(activeIntent.requestedClp)) * 100)}%` }}
                />
              </div>
            </div>

            {activeIntent.status === "awaiting_payment" && (
              <p className="text-center text-sm text-slate-400">Esperando tu transferencia…</p>
            )}

            {(activeIntent.status === "ready_to_buy" || activeIntent.status === "executing") && (
              <>
                <p className="mb-3 text-center text-sm text-emerald-400">✓ Pago confirmado — ya puedes comprar.</p>
                {executeError && <p className="mb-3 text-sm text-rose-400">{executeError}</p>}
                <button
                  disabled={executing || activeIntent.status === "executing"}
                  onClick={handleComprar}
                  className="w-full rounded-lg bg-emerald-500 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {executing ? "Comprando…" : `Comprar por $${Number(activeIntent.receivedClp).toLocaleString("es-CL")}`}
                </button>
              </>
            )}
          </div>
        )}

        {activeIntent && activeIntent.status === "completed" && (
          <div className="text-center">
            <p className="mb-2 text-lg font-semibold text-emerald-400">✨ Compra realizada</p>
            <p className="mb-4 text-sm text-slate-300">
              Recibiste{" "}
              <span className="font-semibold text-slate-50">
                {Number(activeIntent.usdtAmount || 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} USDT
              </span>
              {activeIntent.executedRate && (
                <> a {Number(activeIntent.executedRate).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP/USDT.</>
              )}
            </p>
            <button onClick={handleNuevaCompra} className="w-full rounded-lg border border-white/10 bg-white/5 py-3 font-semibold">
              Hacer otra compra
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
