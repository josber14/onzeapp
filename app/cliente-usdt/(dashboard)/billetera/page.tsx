"use client";

import { useEffect, useState } from "react";
import { useClient } from "../client-context";

export default function BilleteraPage() {
  const { client } = useClient();
  const [saldo, setSaldo] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/usdt-client/purchase-history");
        const data = await res.json();
        if (res.ok && data.ok) {
          const total = data.purchases.reduce((sum: number, p: { usdtAmount: number | null }) => sum + (p.usdtAmount || 0), 0);
          setSaldo(total);
        }
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
          {saldo === null ? "…" : saldo.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} USDT
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Suma de todas tus compras completadas — los retiros todavía no están disponibles.
        </p>
      </div>
    </div>
  );
}
