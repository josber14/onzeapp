import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("onze_session")?.value;
    const session = verifySessionToken(token);
    if (!session?.tenantId) {
      return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const body = await req.json().catch(() => ({}));
    const label = body.label || "ONZE";
    const exchange = body.exchange || "binance";
    const minCloseBalance = body.minCloseBalance ? Number(body.minCloseBalance) : null;

    // Bug real confirmado en vivo (jul 2026): dos clics casi simultáneos en
    // "Iniciar Ciclo" (10ms de diferencia, confirmado por los timestamps en
    // producción) generaron DOS ciclos activos para la misma cuenta -- ambas
    // llamadas leyeron "no hay ciclo activo" antes de que la primera
    // terminara de crear el suyo (el chequeo de arriba y el create no eran
    // atómicos). El usuario cerró el que veía en pantalla, pero el segundo
    // quedó activo escondido, y en cuanto cerró el primero el panel mostró
    // el segundo como si el ciclo "hubiera revivido". Un advisory lock de
    // Postgres, scopeado a esta cuenta (tenantId+exchange+label) y liberado
    // automáticamente al terminar la transacción, hace que una segunda
    // llamada simultánea tenga que ESPERAR a que la primera termine de
    // crear su ciclo antes de poder hacer su propio chequeo -- así siempre
    // lo ve y nunca puede crear un duplicado.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${tenantId}, hashtext(${exchange + ":" + label}))`;

      const existing = await tx.p2PCycle.findFirst({
        where: { tenantId, exchange, label, status: "active" },
      });
      if (existing) {
        return { alreadyActive: true as const, cycle: existing };
      }

      // El nuevo ciclo continúa exactamente donde terminó el último cerrado
      // (un instante después de su última orden capturada), no desde "ahora".
      // Así, si el usuario se demora en iniciar el siguiente ciclo, ninguna
      // orden que haya entrado en el medio queda sin contar. Si el ciclo
      // anterior no tuvo ninguna orden, se usa su hora de cierre. Si es el
      // primer ciclo de todos, arranca desde ahora (comportamiento original).
      const lastClosed = await tx.p2PCycle.findFirst({
        where: { tenantId, exchange, label, status: "closed" },
        orderBy: { id: "desc" },
      });

      let startTime = new Date();
      if (lastClosed?.lastOrderTime) {
        startTime = new Date(lastClosed.lastOrderTime.getTime() + 1);
      } else if (lastClosed?.endTime) {
        startTime = lastClosed.endTime;
      }

      const created = await tx.p2PCycle.create({
        data: {
          tenantId,
          label,
          exchange,
          status: "active",
          startTime,
          minCloseBalance: minCloseBalance ?? undefined,
        },
      });

      // Botón "Sacar del ciclo" (ago 2026): las ventas que quedaron
      // "apartadas" (sacadas de un ciclo anterior, sin reclamar por nadie
      // todavía) pasan a contar en el ciclo que recién arranca -- es el
      // punto exacto donde el usuario dijo que deben "entrar".
      await tx.p2PCycleSetAsideOrder.updateMany({
        where: { tenantId, exchange, label, claimedByCycleId: null },
        data: { claimedByCycleId: created.id, claimedAt: new Date() },
      });

      return { alreadyActive: false as const, cycle: created };
    });

    if (result.alreadyActive) {
      return Response.json({ ok: false, error: "Ya hay un ciclo activo para esta etiqueta", cycle: result.cycle });
    }

    return Response.json({ ok: true, cycle: result.cycle });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
