"use client";

import { useClient } from "../client-context";

export default function BilleteraPage() {
  const { client } = useClient();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-bold">Hola, {client.fullName}</h1>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-xs text-slate-400">Saldo disponible</div>
        <div className="mt-1 text-3xl font-bold text-emerald-400">0.00 USDT</div>
        <p className="mt-3 text-xs text-slate-500">
          Tu saldo aparecerá aquí apenas se habilite la compra en vivo.
        </p>
      </div>
    </div>
  );
}
