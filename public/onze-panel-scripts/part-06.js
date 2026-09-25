
(function(){
  if (window.__onzeWhatsappEmojiFix) return;
  window.__onzeWhatsappEmojiFix = true;

  function stableFlag(country){
    const codeMap = {
      "Argentina":"AR",
      "Bolivia":"BO",
      "Brasil":"BR",
      "Brazil":"BR",
      "Chile":"CL",
      "Colombia":"CO",
      "Ecuador":"EC",
      "España":"ES",
      "Spain":"ES",
      "Peru":"PE",
      "Perú":"PE",
      "Paraguay":"PY",
      "Uruguay":"UY",
      "Venezuela":"VE",
      "Mexico":"MX",
      "México":"MX",
      "Estados Unidos":"US",
      "USA":"US",
      "United States":"US",
      "Panamá":"PA",
      "Panama":"PA",
      "Costa Rica":"CR",
      "República Dominicana":"DO",
      "Republica Dominicana":"DO",
      "Dominicana":"DO",
      "Guatemala":"GT",
      "Honduras":"HN",
      "Nicaragua":"NI",
      "El Salvador":"SV",
      "Puerto Rico":"PR",
      "Canadá":"CA",
      "Canada":"CA",
      "Italia":"IT",
      "Francia":"FR",
      "France":"FR",
      "Alemania":"DE",
      "Germany":"DE"
    };

    const clean = String(country || "").trim();
    const code = codeMap[clean];
    if(!code) return "";

    return code
      .toUpperCase()
      .split("")
      .map(ch => String.fromCodePoint(127397 + ch.charCodeAt(0)))
      .join("");
  }

  window.getFlagEmoji = stableFlag;

  function aggregateCountryProfitForWhatsappFixed(ops){
    const map = new Map();
    (ops || []).forEach(op => {
      const country = op.profitCountry || op.originCountry || "—";
      const currency = op.profitCurrency || (typeof getCurrencyFor === "function" ? getCurrencyFor(country) : "");
      const key = `${country}|${currency}`;
      if(!map.has(key)) map.set(key, { country, currency, total: 0 });
      map.get(key).total += Number(op.profitValue || 0);
    });
    return Array.from(map.values()).sort((a,b)=>
      a.country.localeCompare(b.country,"es",{sensitivity:"base"})
    );
  }

  window.buildWhatsappMessage = function(){
    const profile = (typeof loadProfile === "function") ? loadProfile() : {};
    const ops = (typeof loadOperations === "function") ? loadOperations() : [];
    const groups = aggregateCountryProfitForWhatsappFixed(ops);
    const today = new Intl.DateTimeFormat("es-CL", {
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).format(new Date());

    const lines = [
      "📋 CIERRE DIARIO ONZE",
      "",
      `📅 Fecha: ${today}`,
      `👤 Operador: ${profile.fullName || "Operador ONZE"}`,
      `🧾 Cantidad de órdenes: ${ops.length}`,
      "",
      "🌍 Ganancia por país:"
    ];

    groups.forEach(g => {
      const flag = stableFlag(g.country);
      const amount = (typeof formatCalcValue === "function")
        ? formatCalcValue(g.total, g.currency)
        : String(g.total || 0);
      lines.push(`• ${flag ? flag + " " : ""}${g.country}: ${amount} ${g.currency}`);
    });

    lines.push("");
    lines.push("💰 Total final a pagar:");

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
      lines.push("🤝 Pago a socios que cubrieron destino:");
      lines.push(`• Costo destino: ${formatCalcValue(totalDestCost, "USDT")} USDT`);
      lines.push(`• Total a pagar al socio: ${formatCalcValue(totalSocioPayout, "USDT")} USDT`);
    }

    return lines.join("\n");
  };

  function rebindWhatsappButtons(){
    const btn = document.getElementById("dashboardShareBtn");
    if(btn){
      btn.onclick = function(){
        if(typeof requireProfileForAction === "function"){
          const ok = requireProfileForAction("Debes completar tu perfil antes de enviar el cierre por WhatsApp.");
          if(!ok) return;
        }
        const text = window.buildWhatsappMessage();
        window.open(`https://wa.me/56951333777?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      };
    }
  }

  document.addEventListener("DOMContentLoaded", rebindWhatsappButtons);
  rebindWhatsappButtons();
})();
