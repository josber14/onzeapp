"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ClientInfo = {
  id: number;
  email: string;
  fullName: string;
  status: string;
  purchaseLimitClp: number | null;
  walletAddress: string | null;
  withdrawalNetwork: string | null;
};

type ClientContextValue = {
  client: ClientInfo;
  refresh: () => Promise<void>;
};

const ClientContext = createContext<ClientContextValue | null>(null);

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient debe usarse dentro de ClientProvider");
  return ctx;
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usdt-client/me");
      const data = await res.json();
      if (!data.ok) {
        window.location.href = "/cliente-usdt/login";
        return;
      }
      if (data.client.status !== "approved") {
        window.location.href = "/cliente-usdt/pendiente";
        return;
      }
      setClient(data.client);
    } catch {
      window.location.href = "/cliente-usdt/login";
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#041126] text-slate-400">
        Cargando…
      </main>
    );
  }
  if (!client) return null;

  return <ClientContext.Provider value={{ client, refresh: load }}>{children}</ClientContext.Provider>;
}
