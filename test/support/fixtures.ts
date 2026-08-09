// Datos de prueba reutilizables para el harness del chatbot P2P.

// Números de orden reales de Binance son enteros de 20 dígitos -- acá basta
// con que sean únicos por prueba, así que un prefijo fijo + contador alcanza
// sin necesitar BigInt (el tsconfig del proyecto no lo permite).
let orderCounter = 0;

export function nextOrderNumber(): string {
  orderCounter += 1;
  return "22900000000000" + String(orderCounter).padStart(6, "0");
}

// Forma ya NORMALIZADA de una orden (la misma que devuelve normalizeOrder()
// en chat-agent.ts) -- se usa así porque las pruebas llaman a processOrder()
// directo, sin pasar por la respuesta cruda de la API de Binance/Bybit.
export function makeOrder(overrides: Partial<Record<string, any>> = {}) {
  return {
    orderNumber: nextOrderNumber(),
    advNo: "adv-1",
    tradeType: "SELL",
    asset: "USDT",
    fiat: "CLP",
    amount: 500,
    unitPrice: 920,
    totalPrice: 460000,
    status: "pending",
    group: "pending",
    counterparty: "test***",
    createdAt: new Date().toISOString(),
    executedAt: new Date().toISOString(),
    payTime: 15,
    verified: true,
    buyerRealName: null,
    ...overrides,
  };
}

let accountId = 1;

export function makeAccount(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: accountId++,
    tenantId: 1,
    exchange: "binance",
    label: "ONZE",
    isActive: true,
    sortOrder: 0,
    accountInfo: {
      bank: "BANCO DE CHILE",
      holder: "ZINPLE SPA",
      rut: "77570383-0",
      accountType: "Corriente",
      accountNumber: "1697507110",
      email: "zinple.cl@gmail.com",
    },
    ...overrides,
  };
}

// 3 cuentas por defecto en bancos distintos -- suficiente para reproducir
// escenarios de pago dividido entre varios bancos.
export function makeDefaultAccounts(tenantId = 1, exchange = "binance", label = "ONZE") {
  return [
    makeAccount({ tenantId, exchange, label, sortOrder: 0, accountInfo: { bank: "BANCO DE CHILE", holder: "ZINPLE SPA", rut: "77570383-0", accountType: "Corriente", accountNumber: "1697507110", email: "zinple.cl@gmail.com" } }),
    makeAccount({ tenantId, exchange, label, sortOrder: 1, accountInfo: { bank: "BANCO SANTANDER", holder: "ZINPLE SPA", rut: "77570383-0", accountType: "Corriente", accountNumber: "95968678", email: "zinple.cl@gmail.com" } }),
    makeAccount({ tenantId, exchange, label, sortOrder: 2, accountInfo: { bank: "BANCO BCI", holder: "ZINPLE SPA", rut: "77570383-0", accountType: "Corriente", accountNumber: "71885077", email: "zinple.cl@gmail.com" } }),
  ];
}
