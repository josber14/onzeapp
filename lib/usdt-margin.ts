import { prisma } from "@/lib/prisma";

// Compartido entre la cotización de referencia y la ejecución real de la
// compra — ambas deben aplicar exactamente el mismo margen para el mismo
// monto, nunca lógicas separadas que puedan desincronizarse.
export async function findMarginPct(tenantId: number, clpAmount: number): Promise<number> {
  const tiers = await prisma.usdtMarginTier.findMany({ where: { tenantId }, orderBy: { minClp: "asc" } });
  for (const t of tiers) {
    const min = Number(t.minClp);
    const max = t.maxClp !== null ? Number(t.maxClp) : Infinity;
    if (clpAmount >= min && clpAmount <= max) return Number(t.marginPct);
  }
  // Sin tramo configurado que calce — margen de seguridad por defecto en vez
  // de vender al precio crudo de Skipo (nunca vender sin margen).
  return 3;
}
