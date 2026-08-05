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

  useEffect(() => {
    fetch("/api/usdt-client/2fa/status")
      .then((r) => r.json())
      .then((data) => setTwoFaEnabled(!!data.enabled))
      .catch(() => setTwoFaEnabled(false));

    fetch("/api/usdt-client/balance")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setAvailable(data.availableUsdt); })
      .catch(() => {});

    fetch("/api/usdt-client/withdrawal-addresses")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setAddresses(data.addresses);
          if (data.addresses.length === 1) setSelected(data.addresses[0]);
        }
      })
      .finally(() => setAddressesLoading(false));
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
        <h2 className="mb-1 text-base font-semibold">Retirar USDT</h2>
        <p className="mb-4 text-xs text-slate-500">
          Disponible: {available === null ? "…" : available.toFixed(2)} USDT
        </p>

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
            <label className="mb-1 block text-xs text-slate-400">Monto a retirar (USDT)</label>
            <div className="mb-4 flex gap-2">
              <input
                type="number"
                step="0.00000001"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 outline-none focus:border-emerald-400"
              />
              <button
                type="button"
                onClick={() => setAmount(available !== null ? String(available) : "")}
                className="rounded-lg border border-white/10 px-3 text-sm text-slate-300 transition hover:bg-white/5"
              >
                Max
              </button>
            </div>

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
              disabled={busy || !twoFaEnabled || !hasAddress}
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
    </div>
  );
}
