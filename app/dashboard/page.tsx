import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import LogoutButton from "@/components/logout-button";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  const session = verifySessionToken(token);

  const isAdmin =
    session?.role === "super_admin_global" ||
    session?.role === "super_admin_cliente";

  let panelSrc = "/onze-panel.html";

  let operatorMode = "";
  let dataSourceMode = "";
  let percentageRate = "";
  let partnerSharePercent = "";
  let tenantId = session?.tenantId ?? "";

  if (session?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        operatorMode: true,
        dataSourceMode: true,
        percentageRate: true,
        partnerSharePercent: true,
      },
    });

    operatorMode = user?.operatorMode || "";
    dataSourceMode = user?.dataSourceMode || "";
    percentageRate =
      user?.percentageRate !== null && user?.percentageRate !== undefined
        ? String(user.percentageRate)
        : "";
    partnerSharePercent =
      user?.partnerSharePercent !== null && user?.partnerSharePercent !== undefined
        ? String(user.partnerSharePercent)
        : "";
  }

  const params = new URLSearchParams();

  if (session?.tenantId) {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: {
        sheetUrl: true,
      },
    });

    if (settings?.sheetUrl) {
      params.set("sheetUrl", settings.sheetUrl);
    }
  }

  if (session?.role) {
    params.set("role", session.role);
  }

  if (tenantId !== null && tenantId !== undefined && tenantId !== "") {
    params.set("tenantId", String(tenantId));
  }

  if (operatorMode && !isAdmin) {
    params.set("operatorMode", operatorMode);
  }

  if (dataSourceMode) {
    params.set("dataSourceMode", dataSourceMode);
  }

  if (percentageRate) {
    params.set("percentageRate", percentageRate);
  }

  if (partnerSharePercent) {
    params.set("partnerSharePercent", partnerSharePercent);
  }

  params.set("_v", String(Date.now()));

  const query = params.toString();
  panelSrc = query ? `/onze-panel.html?${query}` : "/onze-panel.html";

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
            src={panelSrc}
            title="ONZE Panel"
            className="h-[calc(100vh-120px)] w-full"
          />
        </div>
      </div>
    </main>
  );
}
