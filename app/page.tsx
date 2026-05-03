import Link from "next/link";

const solutions = [
  {
    title: "Gestión de usuarios",
    text: "Controla registros, roles, estados y permisos desde un solo panel.",
  },
  {
    title: "Control operativo",
    text: "Centraliza cálculo, seguimiento, flujo de trabajo e historial con mayor visibilidad.",
  },
  {
    title: "Escalabilidad por cliente",
    text: "Estructura preparada para crecer por equipos, clientes y distintos modelos operativos.",
  },
];

const reasons = [
  {
    title: "Acceso centralizado",
    text: "Gestiona usuarios, permisos y estructura operativa desde un solo entorno.",
  },
  {
    title: "Control operativo",
    text: "Visualiza operaciones, estados y flujo de trabajo con mayor claridad.",
  },
  {
    title: "Escalable por cliente",
    text: "Preparado para crecer por equipos, clientes y distintos modelos operativos.",
  },
  {
    title: "Información en tiempo real",
    text: "Consulta datos clave y seguimiento operativo con información actualizada.",
  },
  {
    title: "Soporte y continuidad",
    text: "Una plataforma pensada para operar con estabilidad y acompañar tu crecimiento.",
  },
  {
    title: "Infraestructura profesional",
    text: "Diseño claro, experiencia sólida y base tecnológica preparada para evolucionar.",
  },
];

function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-[620px] rounded-[30px] border border-slate-200 bg-white p-4 shadow-[0_20px_70px_rgba(15,23,42,0.10)] sm:p-5">
      <div className="rounded-[28px] bg-[#07152f] p-5 text-white sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-emerald-300">
              ZINPLE CORE
            </div>
            <div className="mt-2 text-2xl font-semibold">
              Control, visibilidad y crecimiento.
            </div>
          </div>

          <div className="w-fit rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-right">
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
                Usuarios, cálculo, accesos y estructura bajo un mismo estándar.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-medium text-slate-300">
                Preparado para escalar
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Construido para clientes con operadores, permisos y administración propia.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
            <div className="text-sm font-medium text-emerald-200">
              Plataforma pensada para crecer contigo
            </div>
            <p className="mt-2 text-sm leading-6 text-emerald-50/90">
              Desde una operación simple hasta una estructura multicliente con administración interna.
            </p>
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
  );
}

function AnalyticsMock() {
  return (
    <div className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-[0_20px_70px_rgba(15,23,42,0.08)] sm:p-5">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Conversión", value: "0.81%", trend: "↑ 1.2%" },
          { label: "Compras únicas", value: "3,137", trend: "↓ 0.7%" },
          { label: "Valor promedio", value: "$306.20", trend: "↓ 0.3%" },
          { label: "Cantidad", value: "1,650", trend: "↑ 2.1%" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {card.label}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className="text-2xl font-semibold text-slate-900">{card.value}</div>
              <span className="pb-1 text-xs font-medium text-emerald-600">
                {card.trend}
              </span>
            </div>
            <div className="mt-4 h-8 rounded-full bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">
              Crecimiento operativo mensual
            </div>
            <div className="flex gap-3 text-xs text-slate-400">
              <span>Actual</span>
              <span>Plan</span>
            </div>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-4xl font-semibold text-slate-900">$620,076</div>
              <div className="mt-2 text-sm text-slate-500">
                Crecimiento total del periodo
              </div>
            </div>
            <div>
              <div className="text-4xl font-semibold text-slate-900">$1,200</div>
              <div className="mt-2 text-sm text-slate-500">
                Promedio por cuenta activa
              </div>
            </div>
          </div>

          <div className="mt-6 h-56 rounded-[24px] bg-gradient-to-b from-sky-50 to-white p-4">
            <div className="flex h-full items-end gap-2">
              {[26, 20, 18, 24, 22, 30, 35, 28, 31, 26, 24, 33].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-2xl bg-sky-300/80"
                  style={{ height: `${h * 4}px` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 p-5">
          <div className="text-sm font-semibold text-slate-700">
            Retención de cuentas
          </div>

          <div className="mt-5 flex h-56 items-end gap-2">
            {[16, 11, 7, 19, 14, 6, 13, 15, 10, 17, 12, 8, 18, 16, 13].map(
              (h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-xl bg-sky-400/75"
                  style={{ height: `${h * 8}px` }}
                />
              )
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-slate-500">Expansiones</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                $1,680.50
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-slate-500">Nuevas cuentas</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                $620.20
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-900">
      <section className="relative overflow-hidden border-b border-slate-200 bg-[linear-gradient(135deg,#041126_0%,#071a39_48%,#0a1f45_100%)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.16),transparent_24%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.12),transparent_22%),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,120px_120px,120px_120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(4,17,38,0.96)_0%,rgba(4,17,38,0.86)_42%,rgba(4,17,38,0.45)_72%,rgba(4,17,38,0.20)_100%)]" />

        <div className="relative mx-auto w-full max-w-7xl px-5 py-6 md:px-6 md:py-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f172a] text-lg font-bold text-white shadow-sm">
                Z
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight text-white">
                  ZINPLE
                </div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300 sm:text-xs">
                  Tecnología • Operación • Control
                </div>
              </div>
            </div>

            <nav className="hidden items-center rounded-full border border-white/10 bg-white/5 p-1 shadow-sm backdrop-blur md:flex">
              <a href="#soluciones" className="rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
                Soluciones
              </a>
              <a href="#planes" className="rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
                Planes
              </a>
              <a href="#compania" className="rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
                Compañía
              </a>
              <a href="#acceso" className="rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
                Acceso
              </a>
            </nav>

            <div className="hidden items-center gap-3 md:flex">
              <Link
                href="/login"
                className="rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
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

          <div className="mt-5 flex flex-col gap-3 sm:flex-row md:hidden">
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0a8f3c] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#087a33]"
            >
              Registrarse
            </Link>
          </div>

          <div className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
            <div>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl xl:text-7xl">
                Centraliza la operación de tu negocio en una sola plataforma.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                ZINPLE permite gestionar usuarios, accesos, operación, estructura interna y seguimiento desde un entorno profesional, claro y preparado para crecer.
              </p>

              <div id="acceso" className="mt-8">
                <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300">
                  Infraestructura digital para operación, estructura y crecimiento
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_28%)] blur-2xl" />
              <div className="relative">
                <HeroMock />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="soluciones" className="mx-auto w-full max-w-7xl px-5 py-16 md:px-6 md:py-20">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Soluciones
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Tres pilares para una operación más ordenada y escalable.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Una base preparada para organizar accesos, control operativo y estructura de crecimiento con mayor claridad.
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {solutions.map((item) => (
            <article
              key={item.title}
              className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-lg font-semibold text-emerald-700">
                ✓
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                {item.text}
              </p>
            </article>
          ))}
        </div>
      </section>


      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-5 py-16 md:px-6 md:py-20">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Servicios y soluciones
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Servicios y soluciones en una misma estructura.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              En ZINPLE integramos asesoría, capacitación y consultoría informática con soluciones tecnológicas orientadas al control operativo, la organización interna y el crecimiento de cada cliente. Nuestro enfoque puede implementarse mediante una herramienta propia o a través de una solución desarrollada según la necesidad de cada operación.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-4">
            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-lg font-semibold text-emerald-700">
                A
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                Asesoría especializada
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Acompañamiento para ordenar procesos, estructura interna y organización operativa.
              </p>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-lg font-semibold text-sky-700">
                C
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                Capacitación aplicada
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Orientación práctica para adopción de herramientas, flujos de trabajo y uso interno.
              </p>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-lg font-semibold text-violet-700">
                I
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                Consultoría informática
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Apoyo en evaluación, implementación y mejora de soluciones digitales según cada necesidad.
              </p>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-lg font-semibold text-amber-700">
                Z
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                Herramienta propia o a medida
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                ZINPLE puede operar con plataforma propia o con una solución desarrollada para el cliente, según el tipo de servicio requerido.
              </p>
            </article>
          </div>

          <div id="planes" className="mt-12 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="max-w-2xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Modalidades de servicio
              </div>
              <h3 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Planes pensados para continuidad y crecimiento.
              </h3>
              <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                Cada modalidad puede contemplar acompañamiento, capacitación, consultoría y acceso a herramienta propia o desarrollada según la necesidad del cliente.
              </p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              <article className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Mensual
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
                  $120.000
                </div>
                <div className="mt-1 text-sm font-medium text-slate-500">
                  CLP
                </div>
                <p className="mt-5 text-sm leading-7 text-slate-600 sm:text-base">
                  Ideal para clientes que necesitan una base de acompañamiento, acceso y organización operativa.
                </p>
              </article>

              <article className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  6 meses
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
                  $630.000
                </div>
                <div className="mt-1 text-sm font-medium text-slate-500">
                  CLP
                </div>
                <p className="mt-5 text-sm leading-7 text-slate-600 sm:text-base">
                  Pensado para quienes buscan continuidad, mejor estructura de trabajo y mayor proyección operativa.
                </p>
              </article>

              <article className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Anual
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
                  $1.200.000
                </div>
                <div className="mt-1 text-sm font-medium text-slate-500">
                  CLP
                </div>
                <p className="mt-5 text-sm leading-7 text-slate-600 sm:text-base">
                  Una modalidad más sólida para clientes que desean estabilidad, soporte continuo y una solución alineada con su crecimiento.
                </p>
              </article>
            </div>

            <div className="mt-8 flex justify-center">
              <a
                href="mailto:zinple.cl@gmail.com?subject=Consulta%20sobre%20planes%20ZINPLE"
                className="inline-flex items-center justify-center rounded-2xl bg-[#0a8f3c] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#087a33]"
              >
                Contacta a un ejecutivo
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 py-16 md:px-6 md:py-20 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Analítica y visibilidad
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Analiza tu operación y toma decisiones con mayor control.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Consulta información clave, seguimiento operativo y estructura de crecimiento desde una plataforma diseñada para dar claridad, orden y visibilidad a cada parte del proceso.
            </p>
          </div>

          <AnalyticsMock />
        </div>
      </section>

      <section id="compania" className="mx-auto w-full max-w-7xl px-5 py-16 md:px-6 md:py-20">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Compañía
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            ¿Por qué elegir ZINPLE?
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Tecnología, estructura y una experiencia profesional para operar con mayor orden, control y continuidad.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {reasons.map((item) => (
            <article
              key={item.title}
              className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="text-lg font-semibold text-slate-950">{item.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                {item.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-950">
        <div className="mx-auto w-full max-w-7xl px-5 py-16 text-white md:px-6 md:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
                ZINPLE
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                Prepara tu operación para crecer con más orden, control y visibilidad.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                ZINPLE reúne estructura, tecnología y control operativo en una sola plataforma.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Iniciar sesión
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-2xl bg-[#0a8f3c] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#087a33]"
              >
                Registrarse
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-10 text-sm text-slate-600 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:px-6">
          <div>
            <div className="text-lg font-semibold text-slate-950">ZINPLE SPA</div>
            <p className="mt-3 max-w-md leading-7">
              Plataforma profesional para estructura operativa, control interno, accesos y crecimiento organizado.
            </p>
          </div>

          <div>
            <div className="font-semibold text-slate-950">Ubicación</div>
            <p className="mt-3 leading-7">
              Agustinas 681 OF 905, Santiago
            </p>
          </div>

          <div>
            <div className="font-semibold text-slate-950">Acceso</div>
            <div className="mt-3 flex flex-col gap-2">
              <Link href="/login" className="transition hover:text-slate-950">
                Iniciar sesión
              </Link>
              <Link href="/register" className="transition hover:text-slate-950">
                Registrarse
              </Link>
              <Link href="/terminos-y-condiciones" className="transition hover:text-slate-950">
                Términos y Condiciones
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
