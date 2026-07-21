"use client";

import { useEffect, useState } from "react";
import { NETWORK_STYLE, avatarColor, initials, shortAddress } from "../contact-display";

type Contact = {
  id: number;
  alias: string;
  currency: string;
  network: string;
  address: string;
};

const NETWORKS = ["TRC20", "ERC20", "BEP20"];

export default function ContactosPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [alias, setAlias] = useState("");
  const [network, setNetwork] = useState("");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadContacts() {
    try {
      const res = await fetch("/api/usdt-client/contacts");
      const data = await res.json();
      if (data.ok) setContacts(data.contacts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  function openNewForm() {
    setEditingId(null);
    setAlias("");
    setNetwork("");
    setAddress("");
    setMessage("");
    setShowForm(true);
  }

  function openEditForm(c: Contact) {
    setEditingId(c.id);
    setAlias(c.alias);
    setNetwork(c.network);
    setAddress(c.address);
    setMessage("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const url = editingId ? `/api/usdt-client/contacts/${editingId}` : "/api/usdt-client/contacts";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, network, address }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo guardar");
        return;
      }
      setShowForm(false);
      await loadContacts();
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar este contacto?")) return;
    await fetch(`/api/usdt-client/contacts/${id}`, { method: "DELETE" });
    await loadContacts();
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Contactos</h1>
          <p className="text-sm text-slate-400">Agrega contactos para enviar pagos</p>
        </div>
        <button
          onClick={openNewForm}
          className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
        >
          + Agregar contacto
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">
            {editingId ? "Editar contacto" : "Nuevo contacto"}
          </h2>

          <label className="mb-1 block text-xs text-slate-400">Alias</label>
          <input
            type="text"
            placeholder="Ej: Juan Pérez"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
          />

          <label className="mb-1 block text-xs text-slate-400">Moneda</label>
          <div className="mb-4 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-400">
            Tether USDT
          </div>

          <label className="mb-1 block text-xs text-slate-400">Red</label>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNetwork(n)}
                className={`rounded-lg border py-2.5 text-sm font-semibold transition ${
                  network === n
                    ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                    : "border-white/10 bg-black/30 text-slate-300 hover:border-white/20"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs text-slate-400">Dirección</label>
          <input
            type="text"
            placeholder="Dirección de la wallet"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
          />

          {message && <p className="mb-3 text-sm text-rose-400">{message}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Lista de contactos</h2>
            {contacts.length > 0 && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-slate-400">
                {contacts.length}
              </span>
            )}
          </div>

          {contacts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-2xl">
                📇
              </div>
              <div>
                <p className="text-sm font-medium text-slate-300">Sin contactos guardados todavía</p>
                <p className="mt-1 text-xs text-slate-500">
                  Agrega a las personas a las que sueles enviar USDT para elegirlas rápido al retirar.
                </p>
              </div>
              <button
                onClick={openNewForm}
                className="mt-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                + Agregar mi primer contacto
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.06]"
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

                  <div className="flex flex-shrink-0 gap-1.5 opacity-80 transition group-hover:opacity-100">
                    <button
                      onClick={() => openEditForm(c)}
                      aria-label={`Editar ${c.alias}`}
                      title="Editar"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-sm text-slate-300 transition hover:bg-white/5"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      aria-label={`Borrar ${c.alias}`}
                      title="Borrar"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/30 text-sm text-rose-400 transition hover:bg-rose-400/10"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
