export default function ClienteUsdtPendientePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#041126] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-100">
        <h1 className="mb-3 text-xl font-bold">Cuenta en revisión</h1>
        <p className="text-sm text-slate-300">
          Todavía no puedes comprar — tu cuenta está pendiente de aprobación. Te avisaremos cuando esté lista.
        </p>
      </div>
    </main>
  );
}
