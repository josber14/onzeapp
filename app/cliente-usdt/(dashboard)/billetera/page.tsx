"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

  const saldoLabel =
    saldo === null ? "…" : saldo.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-lg font-bold">Hola, {client.fullName}</h1>

      <div className="flex flex-col items-center">
        <div className="flex h-56 w-56 items-center justify-center rounded-full border-[10px] border-emerald-400/70">
          <div className="text-center">
            <div className="text-xs text-slate-400">Balance total</div>
            <div className="mt-1 text-3xl font-bold text-white">
              {saldoLabel}
              <span className="ml-1 text-base font-medium text-slate-400">USDT</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-10">
          <Link href="/cliente-usdt/comprar" className="flex flex-col items-center gap-2">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl text-emerald-400 transition hover:bg-white/10">
              +
            </span>
            <span className="text-sm text-slate-300">Comprar</span>
          </Link>
          <Link href="/cliente-usdt/retirar" className="flex flex-col items-center gap-2">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl text-emerald-400 transition hover:bg-white/10">
              ↑
            </span>
            <span className="text-sm text-slate-300">Retirar</span>
          </Link>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Monedas</h2>
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-base font-bold text-[#041126]">
              T
            </span>
            <div>
              <div className="font-semibold text-white">Tether</div>
              <div className="text-xs text-slate-400">{saldoLabel} USDT</div>
            </div>
          </div>
          <div className="text-sm font-medium text-slate-200">{saldoLabel} USD</div>
        </div>
      </div>
    </div>
  );
}
