import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import LogoutButton from "@/components/logout-button";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);

  const isAdmin =
    session?.role === "super_admin_global" ||
    session?.role === "super_admin_cliente";

  return (
    <main className="min-h-screen bg-[#f5f7fb]">
      <div className="border-b bg-white px-4 py-4 shadow-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Panel de control de ONZE
            </h1>
            <p className="text-sm text-gray-600">
              Calculadora y panel operativo
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {isAdmin && (
              <a
                href="/admin"
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 transition"
              >
                Ir a admin
              </a>
            )}

            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 py-4">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          <iframe
            src="/onze-panel.html"
            title="ONZE Panel"
            className="h-[calc(100vh-120px)] w-full"
          />
        </div>
      </div>
    </main>
  );
}
