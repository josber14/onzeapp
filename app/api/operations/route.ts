import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import {
  LiquidityStatus,
  OperatorMode,
  PayoutCurrencyMode,
} from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDecimalString(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return String(num);
}

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("onze_session")?.value || null;
  return verifySessionToken(token);
}

async function resolveCountryByNameOrCode(input: string) {
  const clean = String(input || "").trim();
  if (!clean) return null;

  const byCode = await prisma.country.findFirst({
    where: { code: clean.toUpperCase() },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  if (byCode) return byCode;

  const byName = await prisma.country.findFirst({
    where: { name: clean },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  if (byName) return byName;

  return prisma.country.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
}

function parseOperatorMode(value: string) {
  const raw = String(value || "").trim().toLowerCase();

  const aliases: Record<string, OperatorMode> = {
    porcentaje: "porcentaje",
    percentage: "porcentaje",
    porcentaje_fijo: "porcentaje",
    fixed_percentage: "porcentaje",
    fixedpercent: "porcentaje",
    libre: "libre",
    own_rate: "libre",
    libre_tasa: "libre",
    socio: "socio",
    partner: "socio",
    proveedor: "proveedor",
    provider: "proveedor",
    manual: "manual",
  };

  return aliases[raw] || null;
}

function parseLiquidityStatus(value: string) {
  const allowed = new Set(["ok", "requiere_fondeo", "fondeada"]);
  return allowed.has(value) ? (value as LiquidityStatus) : LiquidityStatus.ok;
}

function parsePayoutCurrencyMode(value?: string | null) {
  if (!value) return null;
  const allowed = new Set(["moneda_origen", "usdt", "moneda_convertida"]);
  return allowed.has(value) ? (value as PayoutCurrencyMode) : null;
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const isAdmin =
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente";

    const operations = await prisma.operation.findMany({
      where: {
        tenantId: session.tenantId,
        ...(isAdmin ? {} : { createdByUserId: session.userId }),
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        originCountry: { select: { name: true, code: true, currencyCode: true } },
        destinationCountry: { select: { name: true, code: true, currencyCode: true } },
        profitBaseCountry: { select: { name: true, code: true, currencyCode: true } },
        convertedProfitTargetCountry: { select: { name: true, code: true, currencyCode: true } },
        shortageCountry: { select: { name: true, code: true, currencyCode: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      operations: operations.map((op) => ({
        id: op.id,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
        deleted: op.deleted,
        deletedAt: op.deletedAt,
        status: op.status,
        date: op.operationDate,
        operationNumber: op.operationNumber,
        operationType: op.operationType || "Cambio",
        note: op.note || "",
        clientName: op.customerNameSnapshot || "",
        operatorMode: op.operatorMode,
        originCountry: op.originCountry.name,
        destCountry: op.destinationCountry.name,
        originCurrency: op.originCurrencyCode,
        destCurrency: op.destinationCurrencyCode,
        sendAmount: Number(op.amountOrigin),
        receiveAmount: op.amountDestination !== null ? Number(op.amountDestination) : 0,
        providerRate: op.providerRateSnapshot !== null ? Number(op.providerRateSnapshot) : null,
        clientRate: op.retailRateSnapshot !== null ? Number(op.retailRateSnapshot) : null,
        profitCountry: op.convertedProfitTargetCountry?.name || op.profitBaseCountry?.name || op.originCountry.name,
        profitCurrency: op.convertedProfitTargetCurrencyCode || op.profitBaseCurrencyCode || op.originCurrencyCode,
        profitValue:
          op.convertedProfitAmount !== null && op.convertedProfitAmount !== undefined
            ? Number(op.convertedProfitAmount)
            : Number(op.profitTotalAmount || 0),
        liquidityStatus: op.liquidityStatus,
        needsFunding: op.needsFunding,
        liquidityShortage: op.liquidityShortage !== null ? Number(op.liquidityShortage) : 0,
        shortageCountry: op.shortageCountry?.name || "",
        shortageCurrency: op.shortageCurrencyCode || "",
        payoutCurrencyMode: op.payoutCurrencyMode || null,
        payoutAmountToOperator: op.payoutAmountToOperator !== null ? Number(op.payoutAmountToOperator) : null,
        payoutCurrencyCode: op.payoutCurrencyCode || null,
        payoutUsdtAmount: op.payoutUsdtAmount !== null ? Number(op.payoutUsdtAmount) : null,
        onzeProfitOriginAmount: op.onzeProfitOriginAmount !== null ? Number(op.onzeProfitOriginAmount) : null,
        onzeProfitOriginCurrencyCode: op.onzeProfitOriginCurrencyCode || null,
      })),
    });
  } catch (error) {
    console.error("OPERATIONS_GET_ERROR", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las operaciones." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const body = await req.json();

    let operationNumber = String(body?.operationNumber || "").trim();
    const operationType = String(body?.operationType || "").trim() || "Cambio";
    const note = String(body?.note || "").trim() || null;
    const clientName = String(body?.clientName || "").trim() || null;
    const operatorModeRaw = String(body?.operatorMode || "").trim();
    const operatorMode = parseOperatorMode(operatorModeRaw);
    console.log("OPERATOR_MODE_DEBUG", {
      operatorModeRaw,
      parsedOperatorMode: operatorMode,
      bodyOperatorMode: body?.operatorMode
    });

    const originCountryInput = String(body?.originCountry || "").trim();
    const destCountryInput = String(body?.destCountry || "").trim();
    const originCurrency = String(body?.originCurrency || "").trim().toUpperCase();
    const destCurrency = String(body?.destCurrency || "").trim().toUpperCase();

    const amountOrigin = toDecimalString(body?.sendAmount);
    const amountDestination = toDecimalString(body?.receiveAmount);

    const providerRate = toDecimalString(body?.providerRate);
    const clientRate = toDecimalString(body?.clientRate);
    const buyOriginValue = toDecimalString(body?.buyOriginValue);
    const sellDestinationValue = toDecimalString(body?.sellDestinationValue);
    const operatorProfitFinalAmount = toDecimalString(body?.operatorProfitFinalAmount);
    const operatorProfitFinalCurrencyCode = String(body?.operatorProfitFinalCurrencyCode || "").trim().toUpperCase() || null;
    const operatorProfitConverted = Boolean(body?.operatorProfitConverted);

    console.log("RATE_DEBUG", {
      providerRateRaw: body?.providerRate,
      clientRateRaw: body?.clientRate,
      providerRateParsed: providerRate,
      clientRateParsed: clientRate,
      buyOriginValueRaw: body?.buyOriginValue,
      sellDestinationValueRaw: body?.sellDestinationValue,
      operatorProfitFinalAmountRaw: body?.operatorProfitFinalAmount,
      operatorProfitFinalCurrencyCode,
      operatorProfitConverted
    });

    const profitCountryInput = String(body?.profitCountry || "").trim();
    const profitCurrency = String(body?.profitCurrency || "").trim().toUpperCase() || null;
    const profitValue = toDecimalString(body?.profitValue) || "0";

    const liquidityStatus = parseLiquidityStatus(String(body?.liquidityStatus || "ok"));
    const needsFunding = Boolean(body?.needsFunding);
    const liquidityShortage = toDecimalString(body?.liquidityShortage);

    const shortageCountryInput = String(body?.shortageCountry || "").trim();
    const shortageCurrency = String(body?.shortageCurrency || "").trim().toUpperCase() || null;

    const payoutCurrencyMode = parsePayoutCurrencyMode(body?.payoutCurrencyMode);
    const payoutAmountToOperator = toDecimalString(body?.payoutAmountToOperator);
    const payoutCurrencyCode = String(body?.payoutCurrencyCode || "").trim().toUpperCase() || null;
    const payoutUsdtAmount = toDecimalString(body?.payoutUsdtAmount);

    const dateRaw = String(body?.date || "").trim();
    const operationDate = dateRaw ? new Date(dateRaw) : new Date();

    if (!operationNumber) {
      return NextResponse.json({ error: "Falta el número de operación." }, { status: 400 });
    }
    if (!operatorMode) {
      return NextResponse.json({ error: "Modo de operador inválido." }, { status: 400 });
    }
    if (!originCountryInput || !destCountryInput) {
      return NextResponse.json({ error: "Debes indicar país origen y destino." }, { status: 400 });
    }
    if (!originCurrency || !destCurrency) {
      return NextResponse.json({ error: "Debes indicar moneda origen y destino." }, { status: 400 });
    }
    if (!amountOrigin || Number(amountOrigin) <= 0) {
      return NextResponse.json({ error: "Monto origen inválido." }, { status: 400 });
    }
    if (!amountDestination || Number(amountDestination) < 0) {
      return NextResponse.json({ error: "Monto destino inválido." }, { status: 400 });
    }
    if (Number.isNaN(operationDate.getTime())) {
      return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
    }

    const originCountry = await resolveCountryByNameOrCode(originCountryInput);
    const destCountry = await resolveCountryByNameOrCode(destCountryInput);

    if (!originCountry || !destCountry) {
      return NextResponse.json({ error: "No se encontró país origen o destino." }, { status: 404 });
    }

    const profitCountry = profitCountryInput
      ? await resolveCountryByNameOrCode(profitCountryInput)
      : null;

    const shortageCountry = shortageCountryInput
      ? await resolveCountryByNameOrCode(shortageCountryInput)
      : null;

    const existingNumbers = await prisma.operation.findMany({
      where: { tenantId: session.tenantId },
      select: { operationNumber: true },
    });

    const usedNumbers = new Set(
      existingNumbers.map((item) => String(item.operationNumber || "").trim())
    );

    if (!operationNumber || usedNumbers.has(operationNumber)) {
      let maxNum = 0;

      for (const item of existingNumbers) {
        const parsed = parseInt(String(item.operationNumber || "").replace(/\D/g, ""), 10);
        if (Number.isFinite(parsed)) {
          maxNum = Math.max(maxNum, parsed);
        }
      }

      operationNumber = String(maxNum + 1).padStart(3, "0");
    }

    const amountDestinationNum = Number(amountDestination || 0);
    const buyOriginValueNum = Number(buyOriginValue || 0);
    const sellDestinationValueNum = Number(sellDestinationValue || 0);

    let onzeProfitUsdt: string | null = null;
    let onzeProfitOriginAmount: string | null = null;
    let onzeProfitOriginCurrencyCode: string | null = originCurrency || null;

    if (
      Number.isFinite(amountDestinationNum) &&
      amountDestinationNum > 0 &&
      Number.isFinite(Number(providerRate || 0)) &&
      Number(providerRate || 0) > 0 &&
      Number.isFinite(buyOriginValueNum) &&
      buyOriginValueNum > 0 &&
      Number.isFinite(sellDestinationValueNum) &&
      sellDestinationValueNum > 0
    ) {
      const originEquivalent = amountDestinationNum / Number(providerRate || 0);
      const originUsdt = originEquivalent / buyOriginValueNum;
      const destUsdt = amountDestinationNum / sellDestinationValueNum;
      const onzeUsdtValue = originUsdt - destUsdt;

      onzeProfitUsdt = String(onzeUsdtValue);
      onzeProfitOriginAmount = String(onzeUsdtValue * buyOriginValueNum);
    }

    const operatorProfitPendingAmount = operatorProfitFinalAmount || null;
    const operatorProfitPaidAmount = operatorProfitFinalAmount ? "0" : null;
    const operatorPayoutStatus = operatorProfitFinalAmount ? "pending" : null;

    const created = await prisma.operation.create({
      data: {
        tenantId: session.tenantId,
        createdByUserId: session.userId,
        operationNumber,
        operationDate,
        operationType,
        note,
        customerNameSnapshot: clientName,
        operatorMode,
        originCountryId: originCountry.id,
        destinationCountryId: destCountry.id,
        originCurrencyCode: originCurrency,
        destinationCurrencyCode: destCurrency,
        amountOrigin,
        amountDestination,
        buyOriginValueSnapshot: buyOriginValue,
        sellDestinationValueSnapshot: sellDestinationValue,
        providerRateSnapshot: providerRate,
        retailRateSnapshot: clientRate,
        profitBaseCountryId: profitCountry?.id || null,
        profitBaseCurrencyCode: profitCurrency,
        profitTotalAmount: profitValue,
        operatorProfitAmount: profitValue,
        superAdminProfitAmount: onzeProfitUsdt || "0",
        operatorProfitFinalAmount,
        operatorProfitFinalCurrencyCode,
        operatorProfitConverted,
        operatorProfitPendingAmount,
        operatorProfitPaidAmount,
        operatorPayoutStatus,
        onzeProfitUsdt,
        onzeProfitOriginAmount,
        onzeProfitOriginCurrencyCode,
        payoutCurrencyMode,
        payoutAmountToOperator,
        payoutCurrencyCode,
        payoutUsdtAmount,
        liquidityStatus,
        needsFunding,
        liquidityShortage,
        shortageCountryId: shortageCountry?.id || null,
        shortageCurrencyCode: shortageCurrency,
      },
      include: {
        originCountry: { select: { name: true, code: true, currencyCode: true } },
        destinationCountry: { select: { name: true, code: true, currencyCode: true } },
        profitBaseCountry: { select: { name: true, code: true, currencyCode: true } },
        shortageCountry: { select: { name: true, code: true, currencyCode: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      operation: {
        id: created.id,
        createdAt: created.createdAt,
        date: created.operationDate,
        operationNumber: created.operationNumber,
        operationType: created.operationType || "Cambio",
        note: created.note || "",
        clientName: created.customerNameSnapshot || "",
        operatorMode: created.operatorMode,
        originCountry: created.originCountry.name,
        destCountry: created.destinationCountry.name,
        originCurrency: created.originCurrencyCode,
        destCurrency: created.destinationCurrencyCode,
        sendAmount: Number(created.amountOrigin),
        receiveAmount: created.amountDestination !== null ? Number(created.amountDestination) : 0,
        providerRate: created.providerRateSnapshot !== null ? Number(created.providerRateSnapshot) : null,
        clientRate: created.retailRateSnapshot !== null ? Number(created.retailRateSnapshot) : null,
        profitCountry: created.profitBaseCountry?.name || created.originCountry.name,
        profitCurrency: created.profitBaseCurrencyCode || created.originCurrencyCode,
        profitValue: Number(created.profitTotalAmount || 0),
        liquidityStatus: created.liquidityStatus,
        needsFunding: created.needsFunding,
        liquidityShortage: created.liquidityShortage !== null ? Number(created.liquidityShortage) : 0,
        shortageCountry: created.shortageCountry?.name || "",
        shortageCurrency: created.shortageCurrencyCode || "",
        payoutCurrencyMode: created.payoutCurrencyMode || null,
        payoutAmountToOperator: created.payoutAmountToOperator !== null ? Number(created.payoutAmountToOperator) : null,
        payoutCurrencyCode: created.payoutCurrencyCode || null,
        payoutUsdtAmount: created.payoutUsdtAmount !== null ? Number(created.payoutUsdtAmount) : null,
      },
    });
  } catch (error) {
    console.error("OPERATIONS_POST_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo guardar la operación." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await getSession();

    if (!session?.tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const isAdmin =
      session.role === "super_admin_global" ||
      session.role === "super_admin_cliente";

    const whereClause = {
      tenantId: session.tenantId,
      ...(isAdmin ? {} : { createdByUserId: session.userId }),
    };

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const operations = await tx.operation.findMany({
        where: whereClause,
        select: { id: true },
      });

      const operationIds = operations.map((op) => op.id);

      if (operationIds.length) {
        await tx.liquidityAlert.deleteMany({
          where: { tenantId, operationId: { in: operationIds } },
        });

        await tx.internalFunding.deleteMany({
          where: { tenantId, operationId: { in: operationIds } },
        });

        await tx.earningsMovement.deleteMany({
          where: { tenantId, operationId: { in: operationIds } },
        });

        await tx.balanceMovement.deleteMany({
          where: { tenantId, operationId: { in: operationIds } },
        });
      }

      const result = await tx.operation.deleteMany({
        where: whereClause,
      });

      return result.count;
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("OPERATIONS_DELETE_ERROR", error);
    return NextResponse.json(
      { error: "No se pudo borrar el historial de operaciones." },
      { status: 500 }
    );
  }
}

