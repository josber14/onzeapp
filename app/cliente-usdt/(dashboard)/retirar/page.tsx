"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NETWORK_STYLE, avatarColor, initials, shortAddress } from "../contact-display";

type WithdrawalAddress = {
  id: number;
  alias: string;
  assetSymbol: string;
  networkSymbol: string;
  address: string;
};

type WithdrawalHistoryItem = {
  id: number;
  amountUsdt: number;
  totalUsdt: number | null;
  status: "pending" | "completed" | "failed" | "error";
  addressAlias: string | null;
  networkSymbol: string | null;
  createdAt: string;
  completedAt: string | null;
};

const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  pending: "En proceso",
  completed: "Completado",
  failed: "Falló",
  error: "Error",
};

const WITHDRAWAL_STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-300",
  completed: "text-emerald-400",
  failed: "text-rose-400",
  error: "text-rose-400",
};

export default function RetirarPage() {
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [addresses, setAddresses] = useState<WithdrawalAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [selected, setSelected] = useState<WithdrawalAddress | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<WithdrawalHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [minWithdrawal, setMinWithdrawal] = useState<number | null>(null);
  const [withdrawalFee, setWithdrawalFee] = useState<number | null>(null);
  const [withdrawalInfoError, setWithdrawalInfoError] = useState(false);

  async function loadHistory() {
    try {
      const res = await fetch("/api/usdt-client/withdrawal-history");
      const data = await res.json();
      if (res.ok && data.ok) setHistory(data.withdrawals);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/usdt-client/2fa/status")
      .then((r) => r.json())
      .then((data) => setTwoFaEnabled(!!data.enabled))
      .catch(() => setTwoFaEnabled(false));

    fetch("/api/usdt-client/balance")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setAvailable(data.availableUsdt); })
      .catch(() => {});

    fetch("/api/usdt-client/withdrawal-info")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setMinWithdrawal(data.minimumWithdrawal);
          setWithdrawalFee(data.withdrawalFee);
        } else {
          setWithdrawalInfoError(true);
        }
      })
      .catch(() => setWithdrawalInfoError(true));

    fetch("/api/usdt-client/withdrawal-addresses")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setAddresses(data.addresses);
          if (data.addresses.length === 1) setSelected(data.addresses[0]);
        }
      })
      .finally(() => setAddressesLoading(false));

    loadHistory();
  }, []);

  useEffect(() => {
    if (!showPicker) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPicker(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showPicker]);

  function pickAddress(a: WithdrawalAddress) {
    setSelected(a);
    setShowPicker(false);
  }

  // Teclado numérico propio (igual que Skipo) en vez de un <input type="number">
  // nativo -- pedido explícito del usuario (ago 2026).
  function handleKeypadPress(key: string) {
    if (key === "back") {
      setAmount((a) => a.slice(0, -1));
      return;
    }
    if (key === ".") {
      setAmount((a) => (a.includes(".") ? a : a === "" ? "0." : a + "."));
      return;
    }
    setAmount((a) => (a === "0" ? key : a + key));
  }

  const amountNumber = Number(amount) || 0;
  const belowMinimum = minWithdrawal !== null && amountNumber > 0 && amountNumber < minWithdrawal;
  const aboveAvailable = available !== null && amountNumber > available;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/usdt-client/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId: selected?.id, amount: Number(amount), code }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(true);
        setMessage("Retiro enviado, lo estamos procesando.");
        loadHistory();
      } else {
        setMessage(data.error || "No se pudo procesar");
      }
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const hasAddress = !!selected;

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-base font-semibold">Retirar USDT</h2>

        {twoFaEnabled === false && (
          <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-300">
            Necesitas activar tu 2FA antes de retirar.{" "}
            <Link href="/cliente-usdt/perfil?tab=2fa" className="font-semibold underline">
              Configurar 2FA
            </Link>
          </div>
        )}

        {success ? (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-4 text-sm text-emerald-300">
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Móvil: número grande + teclado táctil (como Skipo). En PC alcanza con
                escribir el monto con el teclado físico -- ver el input de abajo. */}
            <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-5 text-center md:hidden">
              <div className="flex items-center justify-center gap-2">
                <span className="text-4xl font-bold text-white">{amount || "0"}</span>
                <span className="text-lg font-medium text-slate-400">USDT</span>
              </div>
            </div>

            <div className="mb-4 hidden md:block">
              <label className="mb-1 block text-xs text-slate-400">Monto a retirar (USDT)</label>
              <input
                type="number"
                step="0.00000001"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 outline-none focus:border-emerald-400"
              />
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm">
              <span className="text-slate-400">
                Disponible: <span className="font-semibold text-slate-200">{available === null ? "…" : available.toFixed(8)} USDT</span>
              </span>
              <button
                type="button"
                onClick={() => setAmount(available !== null ? String(available) : "")}
                className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-400/20"
              >
                Max
              </button>
            </div>

            {withdrawalInfoError && (
              <p className="mb-4 text-xs text-rose-400">
                No se pudo obtener el mínimo/comisión de retiro — recarga la página.
              </p>
            )}
            {(minWithdrawal !== null || withdrawalFee !== null) && (
              <div className="mb-4 divide-y divide-white/5 rounded-lg border border-white/10 bg-black/10 px-3 text-sm">
                {minWithdrawal !== null && (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Envío mínimo</span>
                    <span className="text-slate-200">{minWithdrawal} USDT</span>
                  </div>
                )}
                {withdrawalFee !== null && (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Comisión de envío</span>
                    <span className="text-slate-200">{withdrawalFee} USDT</span>
                  </div>
                )}
              </div>
            )}

            <div className="mb-4 grid grid-cols-3 gap-2 md:hidden">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKeypadPress(key)}
                  className="rounded-xl border border-white/5 bg-white/[0.02] py-3 text-xl font-medium text-slate-100 transition hover:bg-white/5 active:bg-white/10"
                >
                  {key === "back" ? "⌫" : key}
                </button>
              ))}
            </div>

            {belowMinimum && (
              <p className="mb-3 text-xs text-amber-300">El monto mínimo de retiro es {minWithdrawal} USDT.</p>
            )}
            {aboveAvailable && (
              <p className="mb-3 text-xs text-rose-400">Superas tu saldo disponible.</p>
            )}

            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-slate-400">Dirección de destino</label>
            </div>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="mb-1 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left text-sm text-slate-300 transition hover:border-white/20"
            >
              {hasAddress ? (
                <span>
                  {selected!.alias}{" "}
                  <span className="font-mono text-xs text-slate-500">({shortAddress(selected!.address)})</span>
                </span>
              ) : (
                <span className="text-slate-500">
                  {addressesLoading ? "Cargando…" : "Elige una dirección"}
                </span>
              )}
              <span className="text-slate-500">▾</span>
            </button>
            {!addressesLoading && addresses.length === 0 && (
              <p className="mb-4 text-xs text-slate-500">
                Todavía no tienes ninguna dirección de retiro habilitada — contáctanos para que agreguemos la tuya.
              </p>
            )}
            {addresses.length > 0 && <div className="mb-4" />}

            <label className="mb-1 block text-xs text-slate-400">Código 2FA</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={!twoFaEnabled}
              className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-center tracking-widest outline-none focus:border-emerald-400 disabled:opacity-40"
            />

            {message && <p className="mb-4 text-sm text-rose-400">{message}</p>}

            <button
              type="submit"
              disabled={busy || !twoFaEnabled || !hasAddress || amountNumber <= 0 || belowMinimum || aboveAvailable}
              className="w-full rounded-lg bg-emerald-500 py-3 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
            >
              Retirar
            </button>
          </form>
        )}
      </div>

      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={() => setShowPicker(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-white/10 bg-[#0a1830] shadow-2xl sm:max-w-sm sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Elegir destino</h3>
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                aria-label="Cerrar"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-3 py-3">
              {addresses.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center">
                  <p className="text-xs text-slate-500">
                    Todavía no tienes ninguna dirección habilitada para retirar.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {addresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => pickAddress(a)}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarColor(a.alias)}`}
                      >
                        {initials(a.alias)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white">{a.alias}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              NETWORK_STYLE[a.networkSymbol] || "border-white/10 bg-white/5 text-slate-400"
                            }`}
                          >
                            {a.networkSymbol}
                          </span>
                          <span className="truncate font-mono text-xs text-slate-500">{shortAddress(a.address)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Historial de retiros</h2>
        {historyLoading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!historyLoading && history.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-sm text-slate-400">Sin retiros todavía.</p>
          </div>
        )}
        {!historyLoading && history.length > 0 && (
          <div className="flex flex-col gap-3">
            {history.map((w) => (
              <div key={w.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex justify-between text-sm text-slate-300">
                  <span>{new Date(w.createdAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })}</span>
                  <span className={`font-semibold ${WITHDRAWAL_STATUS_COLOR[w.status] || "text-slate-300"}`}>
                    {WITHDRAWAL_STATUS_LABEL[w.status] || w.status}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-400">
                    {w.addressAlias || "—"}
                    {w.networkSymbol ? ` · ${w.networkSymbol}` : ""}
                  </span>
                  <span className="font-semibold text-slate-50">
                    {(w.totalUsdt ?? w.amountUsdt).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
