"use client";

import { useEffect, useState } from "react";
import { useClient } from "../client-context";

export default function BilleteraPage() {
  const { client } = useClient();
  const [saldo, setSaldo] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/usdt-client/balance");
        const data = await res.json();
        if (res.ok && data.ok) setSaldo(data.availableUsdt);
      } catch {
        // se queda en null (cargando) — no rompe la pantalla
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-bold">Hola, {client.fullName}</h1>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-xs text-slate-400">Saldo disponible</div>
        <div className="mt-1 text-3xl font-bold text-emerald-400">
          {saldo === null ? "…" : saldo.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Compras completadas menos retiros ya realizados.
        </p>
      </div>
    </div>
  );
}
