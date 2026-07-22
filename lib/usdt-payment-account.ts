// Cuenta bancaria donde caen los pagos de Activos Digitales — configurable
// por env var en vez de hardcodeada, mismo criterio que el resto de
// credenciales/config sensible de este proyecto (ej. SKIPO_API_KEY).
export function getUsdtPaymentAccount() {
  return {
    bank: process.env.USDT_PAYMENT_BANK_NAME || "",
    accountNumber: process.env.USDT_PAYMENT_ACCOUNT_NUMBER || "",
    rut: process.env.USDT_PAYMENT_RUT || "",
    holderName: process.env.USDT_PAYMENT_HOLDER_NAME || "",
    // Algunos bancos (ej. Banco Estado, confirmado con el bot de Binance)
    // piden un correo para agregar un destinatario nuevo — no afecta la
    // transferencia real, es solo un requisito del formulario del pagador.
    email: process.env.USDT_PAYMENT_EMAIL || "",
  };
}
