// Motor de Capacity del lado del servidor -- ver AGENTS.md ("DECISION DE
// ARQUITECTURA (confirmada con el usuario): NEON ES LA UNICA FUENTE DE
// VERDAD") y el plan de esta etapa. Replica la MISMA lógica de reparto que
// calculateP2PCapacityStats() en public/onze-panel.html (líneas ~19617 en
// adelante), pero puro y sobre datos que ya vienen 100% de Neon (sin
// localStorage), pensado para correr en el servidor sin depender de qué
// navegador esté abierto.
//
// Diferencias deliberadas contra la versión del navegador:
// - No existe `paidClp` (nunca se guardó en Neon -- ver AGENTS.md, decisión
//   ya tomada con el usuario: se ignora, la cobertura de un capacity sale
//   solo de `manualPaymentsClp` + ventas reales).
// - No existe "carryover" ni "capital propio" (getP2PCapacityCarryover /
//   getP2POwnCapitalTotalUsdt) -- ambos viven solo en localStorage del
//   navegador, sin equivalente en Neon.
//
// Un capacity "finished" SÍ se congela igual que en el navegador (se
// mantiene lo ya guardado, no se le asigna nada nuevo) -- confirmado con
// datos reales (comparación en frío, sep 2026): un capacity puede cerrarse
// con una pequeña porción sin cubrir (ej. el 1% de tolerancia que usa
// finishCapacityManually, o un ajuste manual) y quedar frozen con ese
// resto pendiente para siempre. Si este motor lo recalculara "desde cero"
// ignorando su status, ese resto quedaría disponible y el capacity seguiría
// absorbiendo ventas nuevas indefinidamente -- acaparando dinero real que en
// la realidad ya fue a otro capacity, y dejando a TODOS los capacitys
// posteriores sin nada (justo el bug que este motor existe para evitar, no
// para reproducir). Por eso se replica el mismo mecanismo de "lockedByOrder"
// del navegador: la porción de cada venta ya asignada a un capacity YA
// finalizado se descuenta antes de repartir el resto entre los activos.

export interface FifoCapacityInput {
  id: string;
  capacityClp: number;
  buyPrice: number;
  usdtAmount: number;
  date: string; // "YYYY-MM-DD"
  createdAt: Date;
  status: string; // "active" | "finished"
  manualPaymentsClp: number;
  // Solo se usan (y son obligatorios en la práctica) cuando status="finished"
  // -- valores ya congelados que guardó /api/p2p/capacity al cerrarlo. Un
  // capacity finalizado NUNCA se recalcula, se toma tal cual está en Neon.
  finalSoldUsdt?: number | null;
  finalClpReceived?: number | null;
  finalCommissionUsdt?: number | null;
  finalCommissionClp?: number | null;
  finalSaleParts?: Array<{ orderNumber?: string; assignedClp?: number }> | null;
}

export interface FifoSaleInput {
  orderNumber: string;
  exchange: string;
  amount: number; // USDT
  totalPrice: number; // CLP
  unitPrice: number;
  commission: number; // USDT
  executedAt: Date;
}

export interface FifoSalePart {
  orderNumber: string;
  exchange: string;
  assignedUsdt: number;
  assignedClp: number;
  unitPrice: number;
  commissionUsdt: number;
  createdAt: string;
}

export interface FifoCapacityResult {
  id: string;
  capacityClp: number;
  buyPrice: number;
  usdtAmount: number;
  date: string;
  status: string;
  manualPaymentsClp: number;
  usedUsdt: number;
  clpReceived: number;
  commissionUsdt: number;
  commissionClp: number;
  pendingClp: number;
  remainingUsdt: number;
  profitClp: number;
  saleParts: FifoSalePart[];
  // Si el motor considera que este capacity YA debería estar "finished"
  // (status actual "active" y pendingClp <= 1 CLP de tolerancia -- mismo
  // umbral que autoFinishP2PCapacities() en el navegador). Un capacity que
  // ya está "finished" en Neon nunca puede dar shouldBeFinished=true (queda
  // congelado, ver arriba).
  shouldBeFinished: boolean;
  // Fecha de la venta más reciente que lo completó (o null si se completó
  // solo por pago manual, sin ninguna venta real involucrada) -- mismo
  // criterio que el navegador usa para no ponerle la fecha de "ahora" a un
  // capacity que en realidad se cubrió hace semanas.
  proposedFinishedAt: Date | null;
}

export interface FifoUnassignedSale {
  orderNumber: string;
  exchange: string;
  clp: number;
  usdt: number;
  executedAt: Date;
}

export interface FifoResult {
  capacities: FifoCapacityResult[];
  unassignedSales: FifoUnassignedSale[];
  totalClpReceived: number;
  totalUsdtSold: number;
}

// Umbral de "venta fantasma" -- igual a window.isP2POrderPhantom() en el
// panel: un residuo de caché puede quedar guardado como 0,0000001 en vez de
// 0 exacto. Acá no debería pasar nunca (los datos vienen de tablas reales,
// no de localStorage), pero se mantiene el mismo filtro por las dudas y
// para tratar ambos motores exactamente igual.
function isPhantomSale(s: FifoSaleInput): boolean {
  return Math.abs(s.amount) < 0.005 || Math.abs(s.totalPrice) < 0.5;
}

export function computeP2PCapacityFifo(
  rawCapacities: FifoCapacityInput[],
  rawSales: FifoSaleInput[],
  markedAsOwnCapital?: Set<string> | null
): FifoResult {
  const capacities = [...rawCapacities].sort((a, b) => {
    const dateA = new Date(a.date || a.createdAt || 0).getTime();
    const dateB = new Date(b.date || b.createdAt || 0).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // Ventas marcadas como "capital propio" (ver P2PCapitalMarkedSale) -- el
  // usuario ya decidió que no son ganancia P2P nueva. Se excluyen acá, igual
  // que en calculateP2PCapacityStats() del panel, para que nunca se les
  // asigne ningún capacity ni cuenten como "sin asignar".
  const sales = rawSales
    .filter((s) => !isPhantomSale(s))
    .filter((s) => !markedAsOwnCapital?.has(s.orderNumber))
    .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

  // Capacitys YA finalizados: se congelan tal cual (mismos valores que
  // /api/p2p/capacity ya tiene guardados) y NO participan del reparto de
  // ventas nuevas. Sus ventas ya asignadas se bloquean por orderNumber para
  // no volver a repartirlas -- ver lockedByOrder en
  // calculateP2PCapacityStats() del navegador.
  const lockedByOrder = new Map<string, number>();
  const frozenResults: FifoCapacityResult[] = [];
  const activeInputs: FifoCapacityInput[] = [];

  for (const c of capacities) {
    if (c.status === "finished") {
      const saleParts = Array.isArray(c.finalSaleParts) ? c.finalSaleParts : [];
      for (const part of saleParts) {
        const key = String(part.orderNumber || "");
        if (!key) continue;
        lockedByOrder.set(key, (lockedByOrder.get(key) || 0) + Number(part.assignedClp || 0));
      }
      const clpReceived = Number(c.finalClpReceived || 0);
      const usedUsdt = Number(c.finalSoldUsdt || 0);
      const commissionUsdt = Number(c.finalCommissionUsdt || 0);
      const commissionClp = Number(c.finalCommissionClp || 0);
      const pendingClp = Math.max(c.capacityClp - c.manualPaymentsClp - clpReceived, 0);
      frozenResults.push({
        id: c.id,
        capacityClp: c.capacityClp,
        buyPrice: c.buyPrice,
        usdtAmount: c.usdtAmount,
        date: c.date,
        status: c.status,
        manualPaymentsClp: c.manualPaymentsClp,
        usedUsdt,
        clpReceived,
        commissionUsdt,
        commissionClp,
        pendingClp,
        remainingUsdt: c.buyPrice > 0 ? pendingClp / c.buyPrice : 0,
        profitClp: clpReceived - usedUsdt * c.buyPrice - commissionClp,
        saleParts: [],
        shouldBeFinished: false,
        proposedFinishedAt: null,
      });
    } else {
      activeInputs.push(c);
    }
  }

  const working = activeInputs.map((c) => ({
    ...c,
    usedUsdt: 0,
    clpReceived: 0,
    commissionUsdt: 0,
    commissionClp: 0,
    saleParts: [] as FifoSalePart[],
  }));

  const unassignedSales: FifoUnassignedSale[] = [];

  for (const sale of sales) {
    const lockedClp = lockedByOrder.get(sale.orderNumber) || 0;
    let saleRemainingClp = Math.max(sale.totalPrice - lockedClp, 0);
    if (saleRemainingClp <= 0) continue;

    for (const cap of working) {
      if (saleRemainingClp <= 0) break;

      // Sin restricción de fecha por capacity -- ver el mismo cambio y su
      // razón completa en calculateP2PCapacityStats() (onze-panel.html).
      // Regla de negocio confirmada (sep 2026): una venta sin asignar solo
      // es válida si NINGÚN capacity está activo; mientras exista al menos
      // uno activo, tiene que cubrirla sin importar su fecha -- FIFO puro
      // por orden de capacity y de venta.
      const capAvailableClp = Math.max(cap.capacityClp - cap.manualPaymentsClp - cap.clpReceived, 0);
      if (capAvailableClp <= 0) continue;

      const assignedClp = Math.min(capAvailableClp, saleRemainingClp);
      const ratio = sale.totalPrice > 0 ? assignedClp / sale.totalPrice : 0;
      const assignedUsdt = sale.amount * ratio;
      const assignedCommissionUsdt = sale.commission * ratio;
      const assignedCommissionClp = assignedCommissionUsdt * (sale.unitPrice || 0);

      cap.usedUsdt += assignedUsdt;
      cap.clpReceived += assignedClp;
      cap.commissionUsdt += assignedCommissionUsdt;
      cap.commissionClp += assignedCommissionClp;
      cap.saleParts.push({
        orderNumber: sale.orderNumber,
        exchange: sale.exchange,
        assignedUsdt,
        assignedClp,
        unitPrice: sale.unitPrice,
        commissionUsdt: assignedCommissionUsdt,
        createdAt: sale.executedAt.toISOString(),
      });

      saleRemainingClp -= assignedClp;
    }

    if (saleRemainingClp > 0.5) {
      const ratio = sale.totalPrice > 0 ? saleRemainingClp / sale.totalPrice : 0;
      unassignedSales.push({
        orderNumber: sale.orderNumber,
        exchange: sale.exchange,
        clp: saleRemainingClp,
        usdt: sale.amount * ratio,
        executedAt: sale.executedAt,
      });
    }
  }

  const activeResults: FifoCapacityResult[] = working.map((cap) => {
    const pendingClp = Math.max(cap.capacityClp - cap.manualPaymentsClp - cap.clpReceived, 0);
    const remainingUsdt = cap.buyPrice > 0 ? pendingClp / cap.buyPrice : 0;
    const usedCost = cap.usedUsdt * cap.buyPrice;
    const profitClp = cap.clpReceived - usedCost - cap.commissionClp;
    const shouldBeFinished = pendingClp <= 1;

    let proposedFinishedAt: Date | null = null;
    if (shouldBeFinished) {
      const lastSaleTs = cap.saleParts.reduce((max, p) => {
        const t = new Date(p.createdAt).getTime();
        return t > max ? t : max;
      }, 0);
      proposedFinishedAt = lastSaleTs > 0 ? new Date(lastSaleTs) : new Date();
    }

    return {
      id: cap.id,
      capacityClp: cap.capacityClp,
      buyPrice: cap.buyPrice,
      usdtAmount: cap.usdtAmount,
      date: cap.date,
      status: cap.status,
      manualPaymentsClp: cap.manualPaymentsClp,
      usedUsdt: cap.usedUsdt,
      clpReceived: cap.clpReceived,
      commissionUsdt: cap.commissionUsdt,
      commissionClp: cap.commissionClp,
      pendingClp,
      remainingUsdt,
      profitClp,
      saleParts: cap.saleParts,
      shouldBeFinished,
      proposedFinishedAt,
    };
  });

  // Se devuelve en el mismo orden original (por fecha/createdAt), mezclando
  // frozen + activos de vuelta.
  const byId = new Map<string, FifoCapacityResult>();
  for (const r of frozenResults) byId.set(r.id, r);
  for (const r of activeResults) byId.set(r.id, r);
  const results = capacities.map((c) => byId.get(c.id)!);

  return {
    capacities: results,
    unassignedSales,
    totalClpReceived: sales.reduce((sum, s) => sum + s.totalPrice, 0),
    totalUsdtSold: sales.reduce((sum, s) => sum + s.amount, 0),
  };
}
