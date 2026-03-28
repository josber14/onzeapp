"use client";

import { useEffect, useState } from "react";

type TenantSettings = {
  id?: number;
  tenantId: number;
  inviteCode?: string | null;
  whatsappClosingNumber?: string | null;
  sheetUrl?: string | null;
  updatedAt?: string;
};

export default function AdminTenantSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<TenantSettings | null>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [whatsappClosingNumber, setWhatsappClosingNumber] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");

  async function loadSettings() {
    try {
      setLoading(true);
      setMessage("");

      const res = await fetch("/api/admin/tenant-settings", {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo cargar la configuración.");
        return;
      }

      const s = data.settings || null;
      setSettings(s);
      setInviteCode(s?.inviteCode || "");
      setWhatsappClosingNumber(s?.whatsappClosingNumber || "");
      setSheetUrl(s?.sheetUrl || "");
    } catch {
      setMessage("Ocurrió un error cargando la configuración.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    try {
      setSaving(true);
      setMessage("");

      const res = await fetch("/api/admin/tenant-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviteCode,
          whatsappClosingNumber,
          sheetUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo guardar la configuración.");
        return;
      }

      setMessage("Configuración guardada correctamente.");
      await loadSettings();
    } catch {
      setMessage("Ocurrió un error guardando la configuración.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-900 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-200">
                  ONZE · Configuración del tenant
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                  Ajustes de operación y conexión
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-slate-200 md:text-base">
                  Define el código de invitación, el WhatsApp de cierre diario y la URL del sheet de este tenant.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href="/admin"
                  className="inline-flex items-center justify-center rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Volver al admin
                </a>

                <button
                  onClick={loadSettings}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Actualizar
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Configuración principal</h2>
          <p className="mt-1 text-sm text-slate-500">
            Estos datos quedarán ligados al tenant actual y definirán cómo se conectan usuarios, cierres y hoja de trabajo.
          </p>

          {loading ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              Cargando configuración...
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-6 grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Código de invitación del tenant
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Ej: FALCON-TEAM"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Este código lo usará el equipo al registrarse para quedar enlazado a este tenant.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Número de WhatsApp para cierre diario
                </label>
                <input
                  type="text"
                  value={whatsappClosingNumber}
                  onChange={(e) => setWhatsappClosingNumber(e.target.value)}
                  placeholder="Ej: 56912345678"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Aquí llegará el cierre diario del tenant.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  URL del Google Sheet / CSV
                </label>
                <input
                  type="text"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/..."
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Esta URL será la fuente de tasas propia del tenant.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-70"
                >
                  {saving ? "Guardando..." : "Guardar configuración"}
                </button>

                {settings?.updatedAt && (
                  <span className="text-xs text-slate-500">
                    Última actualización: {new Date(settings.updatedAt).toLocaleString("es-CL")}
                  </span>
                )}
              </div>
            </form>
          )}

          {message && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
