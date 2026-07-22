"use client";

import { useEffect, useState } from "react";

type Purchase = {
  id: number;
  requestedClp: number;
  receivedClp: number;
  usdtAmount: number | null;
  executedRate: number | null;
  executedAt: string | null;
};

export default function HistorialPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/usdt-client/purchase-history");
        const data = await res.json();
        if (res.ok && data.ok) setPurchases(data.purchases);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-bold">Historial</h1>

      {loading && <p className="text-sm text-slate-400">Cargando…</p>}

      {!loading && purchases.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <p className="text-sm text-slate-400">Sin compras todavía.</p>
        </div>
      )}

      {!loading && purchases.length > 0 && (
        <div className="flex flex-col gap-3">
          {purchases.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between text-sm text-slate-300">
                <span>{p.executedAt ? new Date(p.executedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : ""}</span>
                <span className="font-semibold text-slate-50">${p.receivedClp.toLocaleString("es-CL")} CLP</span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-slate-400">Recibiste</span>
                <span className="font-semibold text-emerald-400">
                  {(p.usdtAmount ?? 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} USDT
                </span>
              </div>
              {p.executedRate && (
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>Precio</span>
                  <span>{p.executedRate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CLP/USDT</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
