
(function(){
  if (window.__onzeWhatsappEmojiCompatFix) return;
  window.__onzeWhatsappEmojiCompatFix = true;

  function aggregateCountryProfitCompat(ops){
    const grouped = new Map();
    (ops || []).forEach(op => {
      const country = op.profitCountry || op.originCountry || "—";
      const currency = op.profitCurrency || (typeof getCurrencyFor === "function" ? getCurrencyFor(country) : "");
      const key = `${country}|${currency}`;
      if(!grouped.has(key)) grouped.set(key, { country, currency, total: 0 });
      grouped.get(key).total += Number(op.profitValue || 0);
    });
    return Array.from(grouped.values()).sort((a,b)=>
      a.country.localeCompare(b.country,"es",{sensitivity:"base"})
    );
  }


  window.buildWhatsappMessageSocio = function(){
    const profile = (typeof loadProfile === "function") ? loadProfile() : {};
    const ops = (typeof loadOperations === "function") ? loadOperations() : [];

    const today = new Intl.DateTimeFormat("es-CL", {
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).format(new Date());

    const socioOps = ops.filter(op =>
      op?.operatorMode === "socio" &&
      op?.payerSide === "socio"
    );

    const totalProfit = socioOps.reduce(
      (sum, op) => sum + Number(op.partnerPayoutProfitUsdt || 0),
      0
    );
    const totalDestCost = socioOps.reduce(
      (sum, op) => sum + Number(op.partnerPayoutDestCostUsdt || 0),
      0
    );
    const totalSocioPayout = socioOps.reduce(
      (sum, op) => sum + Number(op.partnerPayoutTotalUsdt || 0),
      0
    );

    const lines = [
      `✨ CIERRE DIARIO ONZE`,
      ``,
      `✳️ Fecha: ${today}`,
      `⭐️ Operador: ${profile.fullName || "Operador ONZE"}`,
      `▪️ Cantidad de órdenes: ${ops.length}`,
      ``,
      `❇️ Ganancia por país:`,
      `• USDT: ${formatCalcValue(totalProfit, "USDT")} USDT`,
      ``,
      `✅ Total final a pagar:`,
      `• ${formatCalcValue(totalProfit, "USDT")} USDT`,
      ``,
      `🤝 Pago a socios que cubrieron destino:`,
      `• Ganancia socio: ${formatCalcValue(totalProfit, "USDT")} USDT`,
      `• Costo destino: ${formatCalcValue(totalDestCost, "USDT")} USDT`,
      `• Total a pagar al socio: ${formatCalcValue(totalSocioPayout, "USDT")} USDT`
    ];

    return lines.join("\n");
  };

  window.buildWhatsappMessageStable = function(){
    const profile = (typeof loadProfile === "function") ? loadProfile() : {};
    const ops = (typeof loadOperations === "function") ? loadOperations() : [];
    const groups = aggregateCountryProfitCompat(ops);

    const today = new Intl.DateTimeFormat("es-CL", {
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).format(new Date());

    // Símbolos/emoji más compatibles en WhatsApp Web/App
    const ICON_HEADER = "✨";
    const ICON_DATE = "✳️";
    const ICON_USER = "⭐️";
    const ICON_ORDERS = "▪️";
    const ICON_WORLD = "❇️";
    const ICON_MONEY = "✅";

    const lines = [
      `${ICON_HEADER} CIERRE DIARIO ONZE`,
      "",
      `${ICON_DATE} Fecha: ${today}`,
      `${ICON_USER} Operador: ${profile.fullName || "Operador ONZE"}`,
      `${ICON_ORDERS} Cantidad de órdenes: ${ops.length}`,
      "",
      `${ICON_WORLD} Ganancia por país:`
    ];

    groups.forEach(g => {
      const amount = (typeof formatCalcValue === "function")
        ? formatCalcValue(g.total, g.currency)
        : String(g.total || 0);

      // Sin banderas en WhatsApp para evitar corrupción
      lines.push(`• ${String(g.country || "").toUpperCase()}: ${amount} ${g.currency}`);
    });

    lines.push("");
    lines.push(`${ICON_MONEY} Total final a pagar:`);

    groups.forEach(g => {
      const amount = (typeof formatCalcValue === "function")
        ? formatCalcValue(g.total, g.currency)
        : String(g.total || 0);

      lines.push(`• ${amount} ${g.currency}`);
    });

    const socioOpsWithDestCost = ops.filter(op =>
      op?.operatorMode === "socio" &&
      op?.payerSide === "socio" &&
      Number(op?.partnerPayoutDestCostUsdt || 0) > 0
    );

    if(socioOpsWithDestCost.length){
      const totalDestCost = socioOpsWithDestCost.reduce(
        (sum, op) => sum + Number(op.partnerPayoutDestCostUsdt || 0),
        0
      );
      const totalSocioPayout = socioOpsWithDestCost.reduce(
        (sum, op) => sum + Number(op.partnerPayoutTotalUsdt || 0),
        0
      );

      lines.push("");
      lines.push(`🤝 Pago a socios que cubrieron destino:`);
      lines.push(`• Costo destino: ${formatCalcValue(totalDestCost, "USDT")} USDT`);
      lines.push(`• Total a pagar al socio: ${formatCalcValue(totalSocioPayout, "USDT")} USDT`);
    }

    return lines.join("\n");
  };

  function bindCompatWhatsappButton(){
    const btn = document.getElementById("dashboardShareBtn");
    if(!btn) return;

    const cloned = btn.cloneNode(true);
    btn.parentNode.replaceChild(cloned, btn);

    cloned.addEventListener("click", ()=>{
      if(typeof requireProfileForAction === "function"){
        const ok = requireProfileForAction("Debes completar tu perfil antes de enviar el cierre por WhatsApp.");
        if(!ok) return;
      }
      const ops = (typeof loadOperations === "function") ? loadOperations() : [];
      const hasSocioPayingDest = ops.some(op =>
        op?.operatorMode === "socio" &&
        op?.payerSide === "socio" &&
        Number(op?.partnerPayoutDestCostUsdt || 0) > 0
      );

      const text = hasSocioPayingDest && typeof window.buildWhatsappMessageSocio === "function"
        ? window.buildWhatsappMessageSocio()
        : window.buildWhatsappMessageStable();

      window.open(`https://wa.me/56951333777?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    });
  }

  document.addEventListener("DOMContentLoaded", bindCompatWhatsappButton);
  setTimeout(bindCompatWhatsappButton, 300);
  setTimeout(bindCompatWhatsappButton, 1000);
})();
