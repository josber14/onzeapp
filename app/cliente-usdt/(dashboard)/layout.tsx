"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ClientProvider } from "./client-context";

const WHATSAPP_NUMBER = "56951333777";

const MAIN_NAV_ITEMS = [
  { href: "/cliente-usdt/billetera", label: "Billetera", icon: "💼" },
  { href: "/cliente-usdt/mercado", label: "Mercado", icon: "📈" },
  { href: "/cliente-usdt/comprar", label: "Comprar", icon: "💱" },
  { href: "/cliente-usdt/retirar", label: "Retirar", icon: "⬆️" },
  { href: "/cliente-usdt/historial", label: "Historial", icon: "📜" },
  { href: "/cliente-usdt/contactos", label: "Contacto", icon: "📇" },
];

const PERFIL_ITEM = { href: "/cliente-usdt/perfil", label: "Perfil", icon: "👤" };

export default function ClienteUsdtDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  function navLinkClass(href: string) {
    const active = pathname === href;
    return `flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition ${
      active ? "bg-emerald-400/10 text-emerald-400" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
    }`;
  }

  const perfilActive = pathname === PERFIL_ITEM.href;

  return (
    <ClientProvider>
      <div className="flex min-h-screen flex-col bg-[#041126] text-slate-100">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-lg font-bold text-white">ZINPLE</div>
          <Link
            href={PERFIL_ITEM.href}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              perfilActive ? "bg-emerald-400/10 text-emerald-400" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            <span className="text-base">{PERFIL_ITEM.icon}</span>
            {PERFIL_ITEM.label}
          </Link>
        </header>

        <div className="grid flex-1 grid-cols-[220px_1fr] max-md:grid-cols-1">
          <aside className="sticky top-[57px] flex h-[calc(100vh-57px)] flex-col border-r border-white/10 p-4 max-md:static max-md:h-auto">
            <nav className="flex flex-col gap-1">
              {MAIN_NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <main className="p-6">{children}</main>
        </div>

        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Soporte por WhatsApp"
          className="fixed bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl shadow-lg transition hover:bg-emerald-400"
        >
          💬
        </a>
      </div>
    </ClientProvider>
  );
}
