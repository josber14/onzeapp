"use client";

import { useEffect, useState } from "react";

const POLL_MS = 30000;

type Tick = { rate: number; createdAt: string };

function PriceChart({ ticks }: { ticks: Tick[] }) {
  if (ticks.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-500">
        Todavía no hay suficiente historial — vuelve en unos minutos.
      </div>
    );
  }

  const rates = ticks.map((t) => t.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;
  const width = 600;
  const height = 160;
  const pad = 8;
  const points = rates
    .map((r, i) => {
      const x = (i / (rates.length - 1)) * width;
      const y = pad + (height - pad * 2) - ((r - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const trendUp = rates[rates.length - 1] >= rates[0];
  const color = trendUp ? "#34d399" : "#fb7185";

  const firstTime = new Date(ticks[0].createdAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const lastTime = new Date(ticks[ticks.length - 1].createdAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{firstTime}</span>
        <span>{lastTime}</span>
      </div>
    </div>
  );
}

export default function MercadoPage() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/usdt-client/price-history");
        const data = await res.json();
        if (res.ok && data.ok) {
          setTicks(data.ticks);
          setCurrent(data.current);
          setHigh(data.high);
          setLow(data.low);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const fmt = (v: number | null) =>
    v === null ? "—" : v.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-bold">Mercado</h1>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-xs uppercase tracking-wide text-slate-400">Precio actual</div>
        <div className="mt-1 text-4xl font-bold text-emerald-400">
          {loading ? "…" : fmt(current)} <span className="text-lg text-slate-400">CLP</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Precio de referencia para una compra típica — el tuyo puede variar un poco según el monto.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-xs text-slate-400">Máximo (última hora)</div>
          <div className="mt-1 text-lg font-semibold text-white">{fmt(high)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-xs text-slate-400">Mínimo (última hora)</div>
          <div className="mt-1 text-lg font-semibold text-white">{fmt(low)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-3 text-sm font-semibold text-slate-200">Movimiento — última hora</div>
        <PriceChart ticks={ticks} />
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        Esta información es solo referencial para ayudarte a decidir cuándo comprar. El precio que realmente pagas se
        fija en el momento en que confirmas tu compra.
      </p>
    </div>
  );
}
