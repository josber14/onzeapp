"use client";

import { useEffect, useMemo, useState } from "react";

type UserItem = {
  id: number;
  fullName: string;
  email: string;
  phone?: string | null;
  residenceCountryCode?: string | null;
  role: "super_admin_global" | "super_admin_cliente" | "operador";
  status: "pendiente" | "activo" | "suspendido" | "rechazado";
  operatorMode?: "porcentaje" | "libre" | "socio" | "proveedor" | "manual" | null;
  dataSourceMode?: "base_onze" | "base_propia" | null;
  percentageRate?: string | number | null;
  partnerSharePercent?: string | number | null;
  canManageOperators: boolean;
  canConnectOwnSheet: boolean;
  createdAt: string;
  tenant?: {
    id: number;
    tradeName: string;
    code: string;
    active: boolean;
  } | null;
};

type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  role: "super_admin_global" | "super_admin_cliente" | "operador";
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"todos" | UserItem["role"]>("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | UserItem["status"]>("todos");

  async function loadUsers() {
    try {
      setLoading(true);
      setMessage("");

      const res = await fetch("/api/admin/users", {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudieron cargar los usuarios.");
        return;
      }

      setUsers(data.users || []);
    } catch {
      setMessage("Ocurrió un error cargando los usuarios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function checkAccess() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const data = await res.json();

        if (!res.ok || !data?.user) {
          window.location.href = "/login";
          return;
        }

        const role = data.user.role;

        if (role !== "super_admin_global" && role !== "super_admin_cliente") {
          window.location.href = "/dashboard";
          return;
        }

        setSessionUser(data.user);
        await loadUsers();
      } catch {
        window.location.href = "/login";
      } finally {
        setCheckingAccess(false);
      }
    }

    checkAccess();
  }, []);

  async function updateUser(
    id: number,
    payload: {
      role?: "super_admin_global" | "super_admin_cliente" | "operador";
      status?: "pendiente" | "activo" | "suspendido" | "rechazado";
      operatorMode?: "porcentaje" | "libre" | "socio" | "proveedor" | "manual" | null;
      dataSourceMode?: "base_onze" | "base_propia" | null;
      percentageRate?: string | number | null;
      partnerSharePercent?: string | number | null;
      canManageOperators?: boolean;
      canConnectOwnSheet?: boolean;
    }
  ) {
    try {
      setSavingId(id);
      setMessage("");

      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "No se pudo actualizar el usuario.");
        return;
      }

      await loadUsers();
    } catch {
      setMessage("Ocurrió un error actualizando el usuario.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  const stats = useMemo(() => {
    const total = users.length;
    const activos = users.filter((u) => u.status === "activo").length;
    const pendientes = users.filter((u) => u.status === "pendiente").length;
    const suspendidos = users.filter((u) => u.status === "suspendido").length;
    const rechazados = users.filter((u) => u.status === "rechazado").length;

    return { total, activos, pendientes, suspendidos, rechazados };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !term ||
        user.fullName.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.phone || "").toLowerCase().includes(term) ||
        (user.tenant?.tradeName || "").toLowerCase().includes(term);

      const matchesRole = roleFilter === "todos" || user.role === roleFilter;
      const matchesStatus = statusFilter === "todos" || user.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  if (checkingAccess) {
    return (
      <main className="min-h-screen bg-[#f6f8fb] flex items-center justify-center px-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Verificando acceso...</h1>
          <p className="mt-2 text-slate-600">Esperando validación de permisos.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                ONZE Admin
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Hola{sessionUser?.fullName ? `, ${sessionUser.fullName}` : ""}
              </h1>

              <p className="mt-2 text-slate-600">
                Gestiona usuarios, roles, estados y estructura operativa desde un
                solo panel.
              </p>

              {sessionUser && (
                <p className="mt-2 text-sm text-slate-500">
                  Sesión activa: {sessionUser.email} · Rol: {sessionUser.role}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href="/dashboard"
                className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Ir a herramienta
              </a>

              <button
                onClick={loadUsers}
                className="rounded-2xl bg-[#0a8f3c] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#087a33]"
              >
                Actualizar
              </button>

              <button
                onClick={handleLogout}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm text-slate-500">Total usuarios</div>
              <div className="mt-2 text-3xl font-semibold text-slate-950">
                {stats.total}
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <div className="text-sm text-emerald-700">Activos</div>
              <div className="mt-2 text-3xl font-semibold text-emerald-800">
                {stats.activos}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="text-sm text-amber-700">Pendientes</div>
              <div className="mt-2 text-3xl font-semibold text-amber-800">
                {stats.pendientes}
              </div>
            </div>

            <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              <div className="text-sm text-orange-700">Suspendidos</div>
              <div className="mt-2 text-3xl font-semibold text-orange-800">
                {stats.suspendidos}
              </div>
            </div>

            <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="text-sm text-red-700">Rechazados</div>
              <div className="mt-2 text-3xl font-semibold text-red-800">
                {stats.rechazados}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr_0.7fr]">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Buscar usuario
                </label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, correo, teléfono o tenant..."
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Filtrar por rol
                </label>
                <select
                  value={roleFilter}
                  onChange={(e) =>
                    setRoleFilter(e.target.value as "todos" | UserItem["role"])
                  }
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                >
                  <option value="todos">Todos</option>
                  <option value="super_admin_global">super_admin_global</option>
                  <option value="super_admin_cliente">super_admin_cliente</option>
                  <option value="operador">operador</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Filtrar por estado
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as "todos" | UserItem["status"])
                  }
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                >
                  <option value="todos">Todos</option>
                  <option value="activo">activo</option>
                  <option value="pendiente">pendiente</option>
                  <option value="suspendido">suspendido</option>
                  <option value="rechazado">rechazado</option>
                </select>
              </div>
            </div>
          </div>

          {message && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message}
            </div>
          )}

          <div className="mt-6 rounded-3xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Usuarios registrados
                </h2>
                <p className="text-sm text-slate-500">
                  Mostrando {filteredUsers.length} de {users.length} usuarios
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-sm text-slate-500">
                    <th className="px-5 py-4">Usuario</th>
                    <th className="px-5 py-4">Tenant</th>
                    <th className="px-5 py-4">Rol</th>
                    <th className="px-5 py-4">Estado</th>
                    <th className="px-5 py-4">Modalidad</th>
                    <th className="px-5 py-4">País</th>
                    <th className="px-5 py-4">Creado</th>
                    <th className="px-5 py-4">Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                        Cargando usuarios...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                        No hay usuarios que coincidan con la búsqueda o filtros.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isCurrentUser = sessionUser?.id === user.id;
                      const isSavingThisUser = savingId === user.id;

                      return (
                        <tr
                          key={user.id}
                          className="border-b border-slate-100 text-sm last:border-b-0"
                        >
                          <td className="px-5 py-5 align-top">
                            <div className="font-semibold text-slate-900">
                              {user.fullName}
                            </div>
                            <div className="mt-1 text-slate-600">{user.email}</div>
                            {user.phone && (
                              <div className="mt-1 text-slate-500">{user.phone}</div>
                            )}
                            {isCurrentUser && (
                              <div className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                Tu cuenta actual
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-5 align-top text-slate-700">
                            {user.tenant ? (
                              <div>
                                <div className="font-medium">{user.tenant.tradeName}</div>
                                <div className="mt-1 text-slate-500">
                                  {user.tenant.code}
                                </div>
                              </div>
                            ) : (
                              "Sin tenant"
                            )}
                          </td>

                          <td className="px-5 py-5 align-top">
                            <select
                              value={user.role}
                              onChange={(e) =>
                                updateUser(user.id, {
                                  role: e.target.value as UserItem["role"],
                                })
                              }
                              disabled={isSavingThisUser || isCurrentUser}
                              className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              <option value="super_admin_global">
                                super_admin_global
                              </option>
                              <option value="super_admin_cliente">
                                super_admin_cliente
                              </option>
                              <option value="operador">operador</option>
                            </select>
                          </td>

                          <td className="px-5 py-5 align-top">
                            <select
                              value={user.status}
                              onChange={(e) =>
                                updateUser(user.id, {
                                  status: e.target.value as UserItem["status"],
                                })
                              }
                              disabled={isSavingThisUser || isCurrentUser}
                              className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              <option value="pendiente">pendiente</option>
                              <option value="activo">activo</option>
                              <option value="suspendido">suspendido</option>
                              <option value="rechazado">rechazado</option>
                            </select>
                          </td>

                          <td className="px-5 py-5 align-top">
                            <div className="space-y-2">
                              <select
                                value={user.operatorMode || ""}
                                onChange={(e) =>
                                  updateUser(user.id, {
                                    operatorMode: (e.target.value || null) as UserItem["operatorMode"],
                                  })
                                }
                                disabled={isSavingThisUser || isCurrentUser}
                                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <option value="">Sin modalidad</option>
                                <option value="porcentaje">porcentaje</option>
                                <option value="libre">libre</option>
                                <option value="socio">socio</option>
                                <option value="proveedor">proveedor</option>
                                <option value="manual">manual</option>
                              </select>

                              <select
                                value={user.dataSourceMode || ""}
                                onChange={(e) =>
                                  updateUser(user.id, {
                                    dataSourceMode: (e.target.value || null) as UserItem["dataSourceMode"],
                                  })
                                }
                                disabled={isSavingThisUser || isCurrentUser}
                                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <option value="">Sin fuente</option>
                                <option value="base_onze">base_onze</option>
                                <option value="base_propia">base_propia</option>
                              </select>

                              <input
                                type="number"
                                step="0.0001"
                                placeholder="% operador"
                                defaultValue={user.percentageRate ?? ""}
                                onBlur={(e) =>
                                  updateUser(user.id, {
                                    percentageRate: e.target.value,
                                  })
                                }
                                disabled={isSavingThisUser || isCurrentUser}
                                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              />

                              <input
                                type="number"
                                step="0.0001"
                                placeholder="% socio"
                                defaultValue={user.partnerSharePercent ?? ""}
                                onBlur={(e) =>
                                  updateUser(user.id, {
                                    partnerSharePercent: e.target.value,
                                  })
                                }
                                disabled={isSavingThisUser || isCurrentUser}
                                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              />

                              <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={user.canManageOperators}
                                  onChange={(e) =>
                                    updateUser(user.id, {
                                      canManageOperators: e.target.checked,
                                    })
                                  }
                                  disabled={isSavingThisUser || isCurrentUser}
                                />
                                Puede gestionar operadores
                              </label>

                              <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={user.canConnectOwnSheet}
                                  onChange={(e) =>
                                    updateUser(user.id, {
                                      canConnectOwnSheet: e.target.checked,
                                    })
                                  }
                                  disabled={isSavingThisUser || isCurrentUser}
                                />
                                Puede conectar base propia
                              </label>
                            </div>
                          </td>

                          <td className="px-5 py-5 align-top text-slate-700">
                            {user.residenceCountryCode || "—"}
                          </td>

                          <td className="px-5 py-5 align-top text-slate-700">
                            {new Date(user.createdAt).toLocaleDateString("es-CL")}
                          </td>

                          <td className="px-5 py-5 align-top">
                            {isCurrentUser ? (
                              <div className="text-xs font-medium text-slate-500">
                                No puedes modificar tu propia cuenta desde este panel.
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <button
                                  onClick={() => updateUser(user.id, { status: "activo" })}
                                  disabled={isSavingThisUser}
                                  className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  Aprobar
                                </button>

                                <button
                                  onClick={() =>
                                    updateUser(user.id, { status: "suspendido" })
                                  }
                                  disabled={isSavingThisUser}
                                  className="rounded-2xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                                >
                                  Suspender
                                </button>

                                <button
                                  onClick={() =>
                                    updateUser(user.id, { status: "rechazado" })
                                  }
                                  disabled={isSavingThisUser}
                                  className="rounded-2xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                                >
                                  Rechazar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
