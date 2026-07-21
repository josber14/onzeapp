"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClient } from "../client-context";
import { NETWORK_STYLE, avatarColor, initials, shortAddress } from "../contact-display";

type Contact = {
  id: number;
  alias: string;
  network: string;
  address: string;
};

// Saldo disponible del cliente — placeholder en 0 hasta que exista el
// registro real de compras (ver Billetera). El botón "Max" ya queda
// conectado a este valor para cuando se active.
const AVAILABLE_USDT = 0;

export default function RetirarPage() {
  const { client } = useClient();
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("");
  // La dirección SIEMPRE parte con la de "Mi Perfil" — la única forma de
  // cambiarla es eligiendo un contacto guardado (nunca escribiéndola a mano
  // acá, para evitar errores de tipeo en un destino real).
  const [address, setAddress] = useState(client.walletAddress || "");
  const [network, setNetwork] = useState(client.withdrawalNetwork || "");
  const [usingContact, setUsingContact] = useState<Contact | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  useEffect(() => {
    fetch("/api/usdt-client/2fa/status")
      .then((r) => r.json())
      .then((data) => setTwoFaEnabled(!!data.enabled))
      .catch(() => setTwoFaEnabled(false));
  }, []);

  useEffect(() => {
    if (!showContactPicker) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowContactPicker(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showContactPicker]);

  async function openContactPicker() {
    setShowContactPicker(true);
    if (contacts.length === 0) {
      setContactsLoading(true);
      try {
        const res = await fetch("/api/usdt-client/contacts");
        const data = await res.json();
        if (data.ok) setContacts(data.contacts);
      } finally {
        setContactsLoading(false);
      }
    }
  }

  function pickContact(c: Contact) {
    setAddress(c.address);
    setNetwork(c.network);
    setUsingContact(c);
    setShowContactPicker(false);
  }

  function useMyWallet() {
    setAddress(client.walletAddress || "");
    setNetwork(client.withdrawalNetwork || "");
    setUsingContact(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/usdt-client/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), address, network, code }),
      });
      const data = await res.json();
      setMessage(data.error || (data.ok ? "Retiro enviado" : "No se pudo procesar"));
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const hasAddress = !!address;

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-1 text-base font-semibold">Retirar USDT</h2>
        <p className="mb-4 text-xs text-slate-500">Disponible: {AVAILABLE_USDT.toFixed(2)} USDT</p>

        {twoFaEnabled === false && (
          <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-300">
            Necesitas activar tu 2FA antes de retirar.{" "}
            <Link href="/cliente-usdt/perfil?tab=2fa" className="font-semibold underline">
              Configurar 2FA
            </Link>
          </div>
        )}

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
              onClick={() => setAmount(String(AVAILABLE_USDT))}
              className="rounded-lg border border-white/10 px-3 text-sm text-slate-300 transition hover:bg-white/5"
            >
              Max
            </button>
          </div>

          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-slate-400">Dirección de destino</label>
            <button
              type="button"
              onClick={openContactPicker}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/5"
            >
              📇 Contacto
            </button>
          </div>
          <div className="mb-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-300">
            {hasAddress ? address : <span className="text-slate-500">Sin dirección configurada</span>}
          </div>
          {usingContact ? (
            <p className="mb-4 text-xs text-slate-500">
              Usando el contacto <strong className="text-slate-300">{usingContact.alias}</strong> ({usingContact.network}) —{" "}
              <button type="button" onClick={useMyWallet} className="underline">usar mi wallet</button>
            </p>
          ) : hasAddress ? (
            <p className="mb-4 text-xs text-slate-500">Tu dirección guardada en Mi Perfil ({network || "sin red"})</p>
          ) : (
            <p className="mb-4 text-xs text-slate-500">
              Configura tu wallet en{" "}
              <Link href="/cliente-usdt/perfil" className="underline">Mi Perfil</Link> o elige un contacto guardado.
            </p>
          )}

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
      </div>

      {showContactPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={() => setShowContactPicker(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-white/10 bg-[#0a1830] shadow-2xl sm:max-w-sm sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Elegir destino</h3>
              <button
                type="button"
                onClick={() => setShowContactPicker(false)}
                aria-label="Cerrar"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-3 py-3">
              {client.walletAddress && (
                <button
                  type="button"
                  onClick={useMyWallet}
                  className="mb-2 flex w-full items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-3 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-lg">
                    ⭐
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">Mi wallet guardada</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          NETWORK_STYLE[client.withdrawalNetwork || ""] || "border-white/10 bg-white/5 text-slate-400"
                        }`}
                      >
                        {client.withdrawalNetwork || "?"}
                      </span>
                      <span className="truncate font-mono text-xs text-slate-500">
                        {shortAddress(client.walletAddress)}
                      </span>
                    </div>
                  </div>
                </button>
              )}

              <div className="mb-1.5 mt-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Contactos guardados
              </div>

              {contactsLoading ? (
                <p className="px-2 py-4 text-center text-sm text-slate-500">Cargando…</p>
              ) : contacts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center">
                  <p className="text-xs text-slate-500">Todavía no tienes contactos guardados.</p>
                  <Link
                    href="/cliente-usdt/contactos"
                    className="text-xs font-semibold text-emerald-400 underline"
                  >
                    Agregar un contacto
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickContact(c)}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarColor(c.alias)}`}
                      >
                        {initials(c.alias)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white">{c.alias}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              NETWORK_STYLE[c.network] || "border-white/10 bg-white/5 text-slate-400"
                            }`}
                          >
                            {c.network}
                          </span>
                          <span className="truncate font-mono text-xs text-slate-500">{shortAddress(c.address)}</span>
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
