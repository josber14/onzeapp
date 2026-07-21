"use client";

import { useState } from "react";
import { useClient } from "../client-context";
import TotpSection from "../totp-section";

const NETWORKS = ["TRC20", "ERC20", "BEP20"];

type Tab = "datos" | "password" | "2fa";

function initialTab(): Tab {
  if (typeof window === "undefined") return "datos";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "password" || t === "2fa" ? t : "datos";
}

const TABS: { id: Tab; label: string }[] = [
  { id: "datos", label: "Datos personales" },
  { id: "password", label: "Cambiar contraseña" },
  { id: "2fa", label: "Autenticación 2FA" },
];

export default function PerfilPage() {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-lg font-bold">Mi Perfil</h1>
      <p className="mb-6 text-sm text-slate-400">
        Administra tu información personal, contraseña y configuración de seguridad
      </p>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id ? "bg-emerald-400/10 text-emerald-400" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        {tab === "datos" && <DatosPersonalesTab />}
        {tab === "password" && <CambiarPasswordTab />}
        {tab === "2fa" && <TotpSection />}
      </div>

      {tab === "datos" && <LogoutButton />}
    </div>
  );
}

function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/usdt-client/logout", { method: "POST" });
    window.location.href = "/cliente-usdt/login";
  }
  return (
    <button
      onClick={handleLogout}
      className="mt-4 w-full rounded-lg border border-white/10 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
    >
      Cerrar sesión
    </button>
  );
}

function DatosPersonalesTab() {
  const { client, refresh } = useClient();
  const [walletAddress, setWalletAddress] = useState(client.walletAddress || "");
  const [withdrawalNetwork, setWithdrawalNetwork] = useState(client.withdrawalNetwork || "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const res = await fetch("/api/usdt-client/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, withdrawalNetwork }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo guardar");
        return;
      }
      setMessage("✅ Guardado");
      await refresh();
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-slate-200">Información de la cuenta</h2>

      <div className="mb-4">
        <div className="text-xs text-slate-400">Email</div>
        <div className="text-sm">{client.email}</div>
      </div>
      <div className="mb-5">
        <div className="text-xs text-slate-400">Nombre legal / Razón social</div>
        <div className="text-sm">{client.fullName}</div>
      </div>

      <form onSubmit={handleSave}>
        <label className="mb-1 block text-xs text-slate-400">Dirección de wallet USDT</label>
        <p className="mb-2 text-xs text-slate-500">Dirección para recibir USDT</p>
        <input
          type="text"
          placeholder="Ingresa tu dirección de wallet (TRC20, ERC20 o BEP20)"
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
        />

        <label className="mb-1 block text-xs text-slate-400">Protocolo de retiro</label>
        <p className="mb-2 text-xs text-slate-500">Red blockchain utilizada para enviar USDT. Solo aplica a retiros.</p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setWithdrawalNetwork(n)}
              className={`rounded-lg border py-2.5 text-sm font-semibold transition ${
                withdrawalNetwork === n
                  ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                  : "border-white/10 bg-black/30 text-slate-300 hover:border-white/20"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {message && <p className="mb-3 text-sm text-slate-300">{message}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>
    </div>
  );
}

function CambiarPasswordTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (newPassword.length < 8) {
      setMessage("La nueva contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("Las contraseñas nuevas no coinciden");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/usdt-client/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo cambiar la contraseña");
        return;
      }
      setMessage("✅ Contraseña actualizada");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setMessage("Ocurrió un error inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-slate-200">Cambiar contraseña</h2>
      <form onSubmit={handleSubmit}>
        <label className="mb-1 block text-xs text-slate-400">Contraseña actual</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
        />

        <label className="mb-1 block text-xs text-slate-400">Nueva contraseña</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
        />

        <label className="mb-1 block text-xs text-slate-400">Repite la nueva contraseña</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          required
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
        />

        {message && <p className="mb-3 text-sm text-slate-300">{message}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
