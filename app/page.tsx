import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,139,34,0.10),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,24,40,0.08),transparent_32%)]" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f172a] text-lg font-bold text-white shadow-sm">
                O
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-900">
                  ONZE
                </div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Plataforma financiera
                </div>
              </div>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <Link
                href="/login"
                className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
              >
                Iniciar sesión
              </Link>
              <Link
                href="/register"
                className="rounded-2xl bg-[#0a8f3c] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#087a33]"
              >
                Registrarse
              </Link>
            </div>
          </header>

          <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                Infraestructura para operadores, clientes y equipos
              </div>

              <h1 className="mt-7 max-w-5xl text-5xl font-semibold leading-[1.05] tracking-tight text-slate-950 md:text-6xl">
                La operación financiera de tu negocio, en una sola plataforma.
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
                ONZE te permite administrar accesos, operadores, clientes,
                cálculo operativo y estructura de crecimiento con una
                experiencia clara, profesional y preparada para escalar.
              </p>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">
                    Gestión de usuarios
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Controla registros, roles, estados y accesos desde un solo
                    panel.
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">
                    Herramienta operativa
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Integra calculadora, flujo de operación e historial en un
                    mismo entorno.
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">
                    Escalable por cliente
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Base lista para trabajar por tenants, equipos y permisos.
                  </p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
                <div className="rounded-[28px] bg-[#07152f] p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-emerald-300">
                        ONZE CORE
                      </div>
                      <div className="mt-2 text-2xl font-semibold">
                        Control, visibilidad y crecimiento.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-right">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300">
                        Estado
                      </div>
                      <div className="mt-1 text-sm font-semibold text-emerald-300">
                        Operativo
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-4">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                      <div className="text-sm font-medium text-slate-300">
                        Estructura por roles
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white">
                          Super admin
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white">
                          Admin cliente
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white">
                          Operador
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                        <div className="text-sm font-medium text-slate-300">
                          Operación centralizada
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-200">
                          Usuarios, cálculo, accesos y estructura bajo un mismo
                          estándar.
                        </p>
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                        <div className="text-sm font-medium text-slate-300">
                          Preparado para escalar
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-200">
                          Construido para clientes con operadores, permisos y
                          administración propia.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                      <div className="text-sm font-medium text-emerald-200">
                        Plataforma pensada para crecer contigo
                      </div>
                      <p className="mt-2 text-sm leading-6 text-emerald-50/90">
                        Desde una operación simple hasta una estructura
                        multicliente con administración interna.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-6 -left-6 hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-lg lg:block">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Flujo
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  Registro → Aprobación → Operación
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>ONZE · Plataforma profesional para estructura operativa financiera</div>
            <div>Acceso centralizado · Roles · Control · Escalabilidad</div>
          </div>
        </div>
      </section>
    </main>
  );
}