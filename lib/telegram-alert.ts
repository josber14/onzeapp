// Envío de alertas del sistema por Telegram (sep 2026, pedido explícito del
// usuario). Bot creado con @BotFather ("Onze_alertas_bot"). Nunca lanza --
// si falta configuración o la llamada a Telegram falla, solo loguea, para
// que un problema de notificación no tumbe el monitor que la dispara.
export async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram-alert] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!res.ok) {
      console.warn("[telegram-alert] Telegram respondió", res.status, await res.text());
    }
  } catch (e: any) {
    console.warn("[telegram-alert] Error enviando a Telegram:", e.message);
  }
}
