"use client";

import { useEffect, useRef, useState } from "react";
import { useClient } from "../client-context";

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
  executedAt: string | null;
};

type PaymentAccount = {
  bank: string;
  accountNumber: string;
  rut: string;
  holderName: string;
  email: string;
};

type PurchaseHistoryItem = {
  id: number;
  requestedClp: number;
  receivedClp: number;
  usdtAmount: number | null;
  executedRate: number | null;
  executedAt: string | null;
};

const REFRESH_SECONDS = 5;
const INTENT_POLL_MS = 6000;

type QuoteParams = { clpAmount: number } | { usdtAmount: number };

export default function ComprarPage() {
  const { client } = useClient();
  const [clpInput, setClpInput] = useState("");
  const [usdtInput, setUsdtInput] = useState("");
  // Cuál de los 2 campos está escribiendo el cliente ahora mismo -- el otro
  // se actualiza solo con el resultado de la cotización, sin disparar una
  // cotización nueva por su cuenta (evita un ping-pong entre los 2 campos).
  const [activeField, setActiveField] = useState<"clp" | "usdt">("clp");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [activeIntent, setActiveIntent] = useState<PurchaseIntent | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [showComprarQuote, setShowComprarQuote] = useState(false);
  const [history, setHistory] = useState<PurchaseHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

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

  async function fetchQuote(params: QuoteParams) {
    try {
      const res = await fetch("/api/usdt-client/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
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
      // Refleja el resultado en el OTRO campo (el que el cliente no está
      // escribiendo activamente), sin tocar el que sí está editando.
      if ("clpAmount" in params) {
        setUsdtInput(data.quote.usdtAmount.toFixed(2));
      } else {
        setClpInput(String(Math.round(data.quote.clpAmount)));
      }
    } catch {
      setError("Ocurrió un error inesperado");
    }
  }

  function startTicking(params: QuoteParams) {
    stopTicking();
    fetchQuote(params);
    refreshIntervalRef.current = setInterval(() => fetchQuote(params), REFRESH_SECONDS * 1000);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_SECONDS : c - 1));
    }, 1000);
  }

  // Cotiza en vivo mientras el cliente decide cuánto comprar — solo mientras
  // no tiene ninguna solicitud de compra en curso todavía. Cada campo tiene
  // su propio efecto, pero solo actúa cuando es el campo que el cliente
  // está escribiendo activamente (activeField) -- así actualizar el otro
  // campo con el resultado no dispara una segunda cotización en cadena.
  useEffect(() => {
    if (activeIntent) return;
    if (activeField !== "clp") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const amount = Number(clpInput);
    if (!clpInput || !(amount >= 500)) {
      stopTicking();
      setQuote(null);
      setError("");
      return;
    }
    debounceRef.current = setTimeout(() => startTicking({ clpAmount: amount }), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clpInput, activeIntent, activeField]);

  useEffect(() => {
    if (activeIntent) return;
    if (activeField !== "usdt") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const amount = Number(usdtInput);
    if (!usdtInput || !(amount > 0)) {
      stopTicking();
      setQuote(null);
      setError("");
      return;
    }
    debounceRef.current = setTimeout(() => startTicking({ usdtAmount: amount }), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdtInput, activeIntent, activeField]);

  useEffect(() => () => stopTicking(), []);

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

  async function loadHistory() {
    try {
      const res = await fetch("/api/usdt-client/purchase-history");
      const data = await res.json();
      if (res.ok && data.ok) setHistory(data.purchases);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
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

  function handleVerCotizacionCompra() {
    if (!activeIntent) return;
    setShowComprarQuote(true);
    startTicking({ clpAmount: Number(activeIntent.receivedClp) });
  }

  function handleCancelarCotizacionCompra() {
    setShowComprarQuote(false);
    stopTicking();
    setQuote(null);
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
      stopTicking();
      setShowComprarQuote(false);
      setActiveIntent(data.intent);
      loadHistory();
    } catch {
      setExecuteError("Ocurrió un error inesperado");
    } finally {
      setExecuting(false);
    }
  }

  function handleNuevaCompra() {
    setActiveIntent(null);
    setClpInput("");
    setUsdtInput("");
    setActiveField("clp");
    setQuote(null);
    setExecuteError("");
  }

  const [sharingReceipt, setSharingReceipt] = useState(false);

  // Dibuja el comprobante como imagen (diseño propio, mismo estilo oscuro +
  // verde de la app) -- pedido explícito del usuario (ago 2026): quería una
  // imagen, no solo texto, para poder emitir la factura mientras se hace la
  // integración real con el SII.
  function buildReceiptImageBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!activeIntent) { resolve(null); return; }
      const W = 720, H = 1000;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }

      const fecha = activeIntent.executedAt
        ? new Date(activeIntent.executedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })
        : new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" });

      // Fondo
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#041126");
      bg.addColorStop(1, "#0a1830");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Marca
      ctx.textAlign = "center";
      ctx.fillStyle = "#34d399";
      ctx.font = "bold 52px system-ui, sans-serif";
      ctx.fillText("ZINPLE", W / 2, 100);
      ctx.fillStyle = "#8aa0ba";
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText("Comprobante de compra USDT", W / 2, 130);

      // Tarjeta
      const cardX = 50, cardY = 170, cardW = W - 100, cardH = 690;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(148,163,184,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === "function") {
        (ctx as any).roundRect(cardX, cardY, cardW, cardH, 24);
      } else {
        ctx.rect(cardX, cardY, cardW, cardH);
      }
      ctx.fill();
      ctx.stroke();

      // Ícono de check
      ctx.fillStyle = "rgba(52,211,153,0.15)";
      ctx.beginPath();
      ctx.arc(W / 2, cardY + 70, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#34d399";
      ctx.font = "bold 42px system-ui, sans-serif";
      ctx.fillText("✓", W / 2, cardY + 84);

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 24px system-ui, sans-serif";
      ctx.fillText("Compra realizada", W / 2, cardY + 150);

      const labelX = cardX + 40;
      const valueX = cardX + cardW - 40;
      let y = cardY + 220;
      const rowGap = 56;

      function row(label: string, value: string, big?: boolean) {
        ctx!.textAlign = "left";
        ctx!.fillStyle = "#8aa0ba";
        ctx!.font = "16px system-ui, sans-serif";
        ctx!.fillText(label, labelX, y);
        ctx!.textAlign = "right";
        ctx!.fillStyle = big ? "#34d399" : "#f1f5f9";
        ctx!.font = `bold ${big ? 22 : 18}px system-ui, sans-serif`;
        ctx!.fillText(value, valueX, y);
        y += rowGap;
      }

      row("Cliente", client.fullName);
      row("Código", activeIntent.referenceCode);
      row("Fecha", fecha);

      ctx.strokeStyle = "rgba(148,163,184,0.15)";
      ctx.beginPath();
      ctx.moveTo(labelX, y - 18);
      ctx.lineTo(valueX, y - 18);
      ctx.stroke();
      y += 20;

      row("Pagado", `$${Number(activeIntent.receivedClp).toLocaleString("es-CL")} CLP`);
      row("Recibido", `${Number(activeIntent.usdtAmount || 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`, true);
      if (activeIntent.executedRate) {
        row("Tasa", `${Number(activeIntent.executedRate).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP/USDT`);
      }

      ctx.textAlign = "center";
      ctx.fillStyle = "#64748b";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("onze-pay.com", W / 2, H - 40);

      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  async function handleCompartirComprobante() {
    if (!activeIntent || activeIntent.status !== "completed") return;
    setSharingReceipt(true);
    try {
      const blob = await buildReceiptImageBlob();
      if (!blob) return;
      const file = new File([blob], `comprobante-${activeIntent.referenceCode}.png`, { type: "image/png" });

      // En celular (donde vive WhatsApp) esto abre el menú nativo de
      // compartir con la imagen ya adjunta -- el cliente solo elige WhatsApp.
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Comprobante de compra USDT" });
          return;
        } catch {
          // El cliente canceló el share o el navegador lo rechazó -- cae a
          // la descarga de abajo para que igual pueda adjuntarla a mano.
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comprobante-${activeIntent.referenceCode}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setSharingReceipt(false);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 2000);
    } catch {
      // Si el navegador no da acceso al portapapeles, no rompe nada — el
      // cliente igual puede seleccionar y copiar el texto a mano.
    }
  }

  async function handleCancelarSolicitud() {
    if (!activeIntent) return;
    setCancelling(true);
    setCancelError("");
    try {
      const res = await fetch(`/api/usdt-client/purchase-intent/${activeIntent.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCancelError(data.error || "No se pudo cancelar");
        return;
      }
      stopIntentPoll();
      handleNuevaCompra();
    } catch {
      setCancelError("Ocurrió un error inesperado");
    } finally {
      setCancelling(false);
    }
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
              onChange={(e) => {
                setActiveField("clp");
                setClpInput(e.target.value.replace(/\D/g, ""));
              }}
              className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-lg outline-none focus:border-emerald-400"
            />

            {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

            <label className="mb-1 block text-xs text-slate-400">Recibes (USDT)</label>
            <div className="flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={usdtInput}
                onChange={(e) => {
                  setActiveField("usdt");
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setUsdtInput(v.includes(".") ? v.slice(0, v.indexOf(".") + 1) + v.slice(v.indexOf(".") + 1).replace(/\./g, "") : v);
                }}
                className="w-full bg-transparent text-2xl font-bold text-emerald-400 outline-none placeholder:text-emerald-400/40"
              />
              <span className="pl-2 text-sm font-medium text-emerald-400/70">USDT</span>
            </div>
            {quote && (
              <div className="mt-2 flex items-center justify-center gap-2 text-base text-white">
                <span>
                  Precio: <span className="font-bold text-white">{quote.rate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP</span>
                </span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-400 text-xs font-bold text-amber-400">
                  {countdown}
                </span>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Este precio es solo referencial — el precio final se fija recién cuando confirmemos tu pago y aprietes "Comprar".
            </p>

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
              <button
                onClick={() => copyToClipboard(activeIntent.referenceCode, "codigo")}
                className="mt-2 rounded-md border border-amber-400/30 px-3 py-1 text-xs text-amber-300"
              >
                {copiedLabel === "codigo" ? "¡Copiado!" : "Copiar código"}
              </button>
            </div>

            {paymentAccount && (
              <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                <div className="mb-1 flex justify-between"><span className="text-slate-400">Banco</span><span>{paymentAccount.bank}</span></div>
                <div className="mb-1 flex justify-between"><span className="text-slate-400">Cuenta</span><span>{paymentAccount.accountNumber}</span></div>
                <div className="mb-1 flex justify-between"><span className="text-slate-400">RUT</span><span>{paymentAccount.rut}</span></div>
                <div className="mb-1 flex justify-between"><span className="text-slate-400">Titular</span><span>{paymentAccount.holderName}</span></div>
                {paymentAccount.email && (
                  <div className="mb-3 flex justify-between"><span className="text-slate-400">Correo</span><span>{paymentAccount.email}</span></div>
                )}
                <button
                  onClick={() =>
                    copyToClipboard(
                      `Banco: ${paymentAccount.bank}\nCuenta: ${paymentAccount.accountNumber}\nRUT: ${paymentAccount.rut}\nTitular: ${paymentAccount.holderName}${paymentAccount.email ? `\nCorreo: ${paymentAccount.email}` : ""}`,
                      "cuenta"
                    )
                  }
                  className="w-full rounded-md border border-white/10 py-1.5 text-xs text-slate-300"
                >
                  {copiedLabel === "cuenta" ? "¡Copiado!" : "Copiar datos bancarios"}
                </button>
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
              <>
                <p className="mb-3 text-center text-sm text-slate-400">Esperando tu transferencia…</p>
                {cancelError && <p className="mb-3 text-sm text-rose-400">{cancelError}</p>}
                <button
                  disabled={cancelling}
                  onClick={handleCancelarSolicitud}
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelling ? "Cancelando…" : "Cancelar solicitud"}
                </button>
              </>
            )}

            {(activeIntent.status === "ready_to_buy" || activeIntent.status === "executing") && !showComprarQuote && (
              <>
                <p className="mb-3 text-center text-sm text-emerald-400">✓ Pago confirmado — ya puedes comprar.</p>
                <button
                  disabled={activeIntent.status === "executing"}
                  onClick={handleVerCotizacionCompra}
                  className="w-full rounded-lg bg-emerald-500 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  Ver cotización y comprar
                </button>
              </>
            )}

            {(activeIntent.status === "ready_to_buy" || activeIntent.status === "executing") && showComprarQuote && (
              <div>
                <div className="mb-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Vas a recibir</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {quote ? quote.usdtAmount.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "…"} USDT
                  </div>
                  {quote && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-base text-white">
                      <span>
                        Precio: <span className="font-bold text-white">{quote.rate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP</span>
                      </span>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-400 text-xs font-bold text-amber-400">
                        {countdown}
                      </span>
                    </div>
                  )}
                </div>

                {executeError && <p className="mb-3 text-sm text-rose-400">{executeError}</p>}

                <div className="flex gap-2">
                  <button
                    disabled={executing}
                    onClick={handleCancelarCotizacionCompra}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 font-semibold text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={executing || !quote}
                    onClick={handleComprar}
                    className="flex-1 rounded-lg bg-emerald-500 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {executing ? "Comprando…" : "Confirmar compra"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeIntent && activeIntent.status === "completed" && (
          <div className="text-center">
            <p className="mb-2 text-lg font-semibold text-emerald-400">✨ Compra realizada</p>
            <p className="mb-4 text-sm text-slate-300">
              Recibiste{" "}
              <span className="font-semibold text-slate-50">
                {Number(activeIntent.usdtAmount || 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </span>
              {activeIntent.executedRate && (
                <> a <span className="font-semibold text-white">{Number(activeIntent.executedRate).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP</span>.</>
              )}
            </p>
            <button
              onClick={handleCompartirComprobante}
              disabled={sharingReceipt}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] py-3 font-semibold text-black transition hover:bg-[#20bd5a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sharingReceipt ? "Generando…" : "📤 Compartir comprobante"}
            </button>
            <button onClick={handleNuevaCompra} className="w-full rounded-lg border border-white/10 bg-white/5 py-3 font-semibold">
              Hacer otra compra
            </button>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Historial de compras</h2>
        {historyLoading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!historyLoading && history.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-sm text-slate-400">Sin compras todavía.</p>
          </div>
        )}
        {!historyLoading && history.length > 0 && (
          <div className="flex flex-col gap-3">
            {history.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex justify-between text-sm text-slate-300">
                  <span>{p.executedAt ? new Date(p.executedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : ""}</span>
                  <span className="font-semibold text-slate-50">${p.receivedClp.toLocaleString("es-CL")} CLP</span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-400">Recibiste</span>
                  <span className="font-semibold text-emerald-400">
                    {(p.usdtAmount ?? 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
                {p.executedRate && (
                  <div className="mt-1 flex justify-between text-sm text-slate-300">
                    <span>Precio</span>
                    <span className="font-semibold text-white">{p.executedRate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
