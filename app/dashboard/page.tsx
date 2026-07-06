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

  if (!isAdmin) {
    params.set("operatorMode", operatorMode || "libre");
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
  panelSrc = query ? `/api/panel?${query}` : "/api/panel";

  return (
    <main className="min-h-screen" style={{background: "linear-gradient(180deg, #020617 0%, #071828 100%)"}}>
      <div className="px-6 py-4" style={{background: "linear-gradient(90deg, rgba(7,24,40,0.95) 0%, rgba(13,33,55,0.95) 100%)", borderBottom: "1px solid rgba(0,212,255,0.15)"}}>
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{color: "#f8fafc", letterSpacing: "0.5px"}}>
              Panel de control de ONZE
            </h1>
            <p className="text-xs" style={{color: "#8aa0ba"}}>
              Calculadora y panel operativo
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {isAdmin && (
              <a
                href="/admin"
                className="rounded-lg px-4 py-2 text-sm font-semibold transition" style={{background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff"}}
              >
                Ir a admin
              </a>
            )}

            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-4 py-4">
        <div className="overflow-hidden rounded-2xl" style={{border: "1px solid rgba(0,212,255,0.15)", background: "transparent", boxShadow: "0 10px 40px rgba(0,0,0,0.5)"}}>
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
