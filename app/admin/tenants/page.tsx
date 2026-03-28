"use client";

import { useEffect, useState } from "react";

type OwnerOption = {
  id: number;
  fullName: string;
  email: string;
  role: "super_admin_global" | "super_admin_cliente" | "operador";
  tenantId?: number | null;
};

type TenantItem = {
  id: number;
  code: string;
  legalName?: string | null;
  tradeName: string;
  ownerUserId?: number | null;
  dataSourceMode: "base_onze" | "base_propia";
  isOnzeInternal: boolean;
  active: boolean;
  createdAt: string;
  ownerUser?: {
    id: number;
    fullName: string;
    email: string;
  } | null;
  _count?: {
    users: number;
    customers: number;
    operations: number;
  };
};

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTenantId, setSavingTenantId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const [code, setCode] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dataSourceMode, setDataSourceMode] = useState<"base_onze" | "base_propia">("base_onze");
  const [isOnzeInternal, setIsOnzeInternal] = useState(false);
  const [active, setActive] = useState(true);

  async function loadTenants() {
    try {
      setLoading(true);
      setMessage("");

      const res = await fetch("/api/admin/tenants", {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudieron cargar los tenants.");
        return;
      }

      setTenants(data.tenants || []);
      setOwnerOptions(data.users || []);
    } catch {
      setMessage("Ocurrió un error cargando los tenants.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();

    try {
      setSaving(true);
      setMessage("");

      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          tradeName,
          legalName,
          ownerUserId,
          dataSourceMode,
          isOnzeInternal,
          active,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo crear el tenant.");
        return;
      }

      setCode("");
      setTradeName("");
      setLegalName("");
      setOwnerUserId("");
      setDataSourceMode("base_onze");
      setIsOnzeInternal(false);
      setActive(true);

      setMessage("Tenant creado correctamente.");
      await loadTenants();
    } catch {
      setMessage("Ocurrió un error creando el tenant.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTenant(
    tenantId: number,
    payload: {
      code?: string;
      tradeName?: string;
      legalName?: string | null;
      ownerUserId?: string | number | null;
      dataSourceMode?: "base_onze" | "base_propia";
      isOnzeInternal?: boolean;
      active?: boolean;
    }
  ) {
    try {
      setSavingTenantId(tenantId);
      setMessage("");

      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo actualizar el tenant.");
        return;
      }

      setMessage("Tenant actualizado correctamente.");
      await loadTenants();
    } catch {
      setMessage("Ocurrió un error actualizando el tenant.");
    } finally {
      setSavingTenantId(null);
    }
  }

  useEffect(() => {
    loadTenants();
  }, []);

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-900 px-6 py-8 text-white md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-200">
                  ONZE · Tenants
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                  Gestión de clientes / tenants
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-slate-200 md:text-base">
                  Crea, edita y organiza la estructura base de clientes, cuentas propias y
                  operación interna de ONZE.
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
                  onClick={loadTenants}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Actualizar
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Crear nuevo tenant</h2>
          <p className="mt-1 text-sm text-slate-500">
            Define el cliente, su fuente de datos y selecciona su owner desde usuarios activos.
          </p>

          <form onSubmit={handleCreateTenant} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Código
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ej: falcon"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Nombre comercial
              </label>
              <input
                type="text"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Falcon Global"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Nombre legal
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Opcional"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Owner del tenant
              </label>
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
              >
                <option value="">Sin owner</option>
                {ownerOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} · {user.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Fuente de datos
              </label>
              <select
                value={dataSourceMode}
                onChange={(e) =>
                  setDataSourceMode(e.target.value as "base_onze" | "base_propia")
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
              >
                <option value="base_onze">base_onze</option>
                <option value="base_propia">base_propia</option>
              </select>
            </div>

            <div className="flex flex-col justify-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isOnzeInternal}
                  onChange={(e) => setIsOnzeInternal(e.target.checked)}
                />
                Es estructura interna ONZE
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Tenant activo
              </label>
            </div>

            <div className="md:col-span-2 xl:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-70"
              >
                {saving ? "Creando..." : "Crear tenant"}
              </button>
            </div>
          </form>

          {message && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Tenants registrados</h2>
            <p className="text-sm text-slate-500">
              Lista de clientes y estructuras activas dentro de ONZE
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1400px] w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-4">Código</th>
                  <th className="px-5 py-4">Nombre</th>
                  <th className="px-5 py-4">Owner</th>
                  <th className="px-5 py-4">Fuente</th>
                  <th className="px-5 py-4">Tipo</th>
                  <th className="px-5 py-4">Estado</th>
                  <th className="px-5 py-4">Usuarios</th>
                  <th className="px-5 py-4">Clientes</th>
                  <th className="px-5 py-4">Operaciones</th>
                  <th className="px-5 py-4">Creado</th>
                  <th className="px-5 py-4">Editar</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-10 text-center text-slate-500">
                      Cargando tenants...
                    </td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-10 text-center text-slate-500">
                      Todavía no hay tenants creados.
                    </td>
                  </tr>
                ) : (
                  tenants.map((tenant) => {
                    const isSavingThisTenant = savingTenantId === tenant.id;

                    return (
                      <tr key={tenant.id} className="border-b border-slate-100 text-sm last:border-b-0">
                        <td className="px-5 py-5 font-medium text-slate-900">{tenant.code}</td>
                        <td className="px-5 py-5">
                          <div className="font-medium text-slate-900">{tenant.tradeName}</div>
                          <div className="mt-1 text-slate-500">{tenant.legalName || "Sin nombre legal"}</div>
                        </td>
                        <td className="px-5 py-5 text-slate-700">
                          {tenant.ownerUser ? (
                            <div>
                              <div className="font-medium">{tenant.ownerUser.fullName}</div>
                              <div className="mt-1 text-slate-500">{tenant.ownerUser.email}</div>
                            </div>
                          ) : (
                            "Sin owner"
                          )}
                        </td>
                        <td className="px-5 py-5 text-slate-700">{tenant.dataSourceMode}</td>
                        <td className="px-5 py-5">
                          {tenant.isOnzeInternal ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                              ONZE interno
                            </span>
                          ) : (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                              Cliente
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-5">
                          {tenant.active ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                              Activo
                            </span>
                          ) : (
                            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                              Inactivo
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-5 text-slate-700">{tenant._count?.users || 0}</td>
                        <td className="px-5 py-5 text-slate-700">{tenant._count?.customers || 0}</td>
                        <td className="px-5 py-5 text-slate-700">{tenant._count?.operations || 0}</td>
                        <td className="px-5 py-5 text-slate-700">
                          {new Date(tenant.createdAt).toLocaleDateString("es-CL")}
                        </td>
                        <td className="px-5 py-5">
                          <div className="grid gap-2 min-w-[260px]">
                            <input
                              type="text"
                              defaultValue={tenant.tradeName}
                              onBlur={(e) =>
                                updateTenant(tenant.id, { tradeName: e.target.value })
                              }
                              disabled={isSavingThisTenant}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                            />

                            <input
                              type="text"
                              defaultValue={tenant.legalName || ""}
                              onBlur={(e) =>
                                updateTenant(tenant.id, { legalName: e.target.value })
                              }
                              disabled={isSavingThisTenant}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                            />

                            <select
                              value={tenant.ownerUserId ?? ""}
                              onChange={(e) =>
                                updateTenant(tenant.id, { ownerUserId: e.target.value })
                              }
                              disabled={isSavingThisTenant}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                            >
                              <option value="">Sin owner</option>
                              {ownerOptions.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.fullName} · {user.email}
                                </option>
                              ))}
                            </select>

                            <select
                              value={tenant.dataSourceMode}
                              onChange={(e) =>
                                updateTenant(tenant.id, {
                                  dataSourceMode: e.target.value as "base_onze" | "base_propia",
                                })
                              }
                              disabled={isSavingThisTenant}
                              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                            >
                              <option value="base_onze">base_onze</option>
                              <option value="base_propia">base_propia</option>
                            </select>

                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={tenant.isOnzeInternal}
                                onChange={(e) =>
                                  updateTenant(tenant.id, {
                                    isOnzeInternal: e.target.checked,
                                  })
                                }
                                disabled={isSavingThisTenant}
                              />
                              Es ONZE interno
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={tenant.active}
                                onChange={(e) =>
                                  updateTenant(tenant.id, {
                                    active: e.target.checked,
                                  })
                                }
                                disabled={isSavingThisTenant}
                              />
                              Tenant activo
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
