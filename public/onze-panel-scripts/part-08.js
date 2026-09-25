
/* ===== ONZE: Calculadora P2P Super Admin ===== */
(function(){
  if(window.__onzeP2PCalculatorLoaded) return;
  window.__onzeP2PCalculatorLoaded = true;

  function isOnzeSuperAdmin(){
    try{
      if(typeof IS_ADMIN_ROLE !== "undefined" && IS_ADMIN_ROLE) return true;

      const possibleKeys = [
        "onzeUser",
        "onze_user",
        "currentUser",
        "onze_current_user",
        "onzeProfile",
        "profile"
      ];

      for(const key of possibleKeys){
        const raw = localStorage.getItem(key);
        if(!raw) continue;

        let data;
        try{ data = JSON.parse(raw); }catch(e){ continue; }

        const role = String(data.role || data.userRole || data.type || "").toLowerCase();
        const email = String(data.email || data.userEmail || "").toLowerCase();

        if(
          role.includes("super") ||
          role.includes("admin") ||
          email.includes("josber")
        ){
          return true;
        }
      }

      const adminBtn = document.querySelector("button, a");
      if(document.body.innerText.includes("Ir a admin")) return true;
    }catch(e){}

    return false;
  }

  function money(n, decimals = 2){
    const value = Number(n || 0);
    return value.toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function pct(n){
    return `${money(n, 2)}%`;
  }

  function getFeeFromLevel(level){
    // Binance P2P Chile / CLP verificado por ONZE:
    // Sin comisión: 0%
    // No verificado: 0.20%
    // Bronce: 0.175%
    // Plata: 0.14%
    // Oro: 0.12%
    // Taker: 0%
    const fees = {
      sin_comision: 0,
      no_verificado: 0.20,
      bronce: 0.175,
      plata: 0.14,
      oro: 0.12
    };

    return fees[level] ?? 0.20;
  }

  function addP2PStyles(){
    if(document.getElementById("onzeP2PStyles")) return;

    const style = document.createElement("style");
    style.id = "onzeP2PStyles";
    style.textContent = `
      .p2p-hero{
        border:1px solid rgba(34,139,34,.22);
        background:
          radial-gradient(circle at top left, rgba(34,139,34,.16), transparent 34%),
          linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,22,37,.98));
        border-radius:26px;
        padding:22px;
        box-shadow:0 18px 60px rgba(0,0,0,.28);
      }

      .p2p-layout{
        display:grid;
        grid-template-columns:1.05fr .95fr;
        gap:18px;
        margin-top:18px;
      }

      .p2p-block{
        border:1px solid rgba(148,163,184,.16);
        background:rgba(15,23,42,.62);
        border-radius:22px;
        padding:18px;
      }

      .p2p-trade-card{
        border:1px solid rgba(148,163,184,.14);
        background:linear-gradient(180deg,rgba(15,23,42,.82),rgba(2,6,23,.92));
        border-radius:20px;
        padding:16px;
        margin-bottom:14px;
      }

      .p2p-trade-card.sell{
        border-color:rgba(34,197,94,.20);
      }

      .p2p-trade-card.buy{
        border-color:rgba(59,130,246,.18);
      }

      .p2p-label{
        color:#a8b3c7;
        font-weight:900;
        letter-spacing:.02em;
        margin-bottom:9px;
        display:flex;
        justify-content:space-between;
        gap:10px;
      }

      .p2p-input,
      .p2p-select{
        width:100%;
        border:1px solid rgba(148,163,184,.18);
        background:rgba(2,6,23,.78);
        color:#f8fafc;
        border-radius:14px;
        padding:14px;
        font-size:15px;
        font-weight:900;
        outline:none;
      }

      .p2p-input:focus,
      .p2p-select:focus{
        border-color:rgba(34,139,34,.58);
        box-shadow:0 0 0 3px rgba(34,139,34,.13);
      }

      .p2p-toggle{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
        margin-bottom:12px;
      }

      .p2p-tab{
        border:1px solid rgba(148,163,184,.14);
        padding:12px;
        background:rgba(2,6,23,.68);
        color:#94a3b8;
        border-radius:14px;
        font-weight:950;
        cursor:pointer;
        transition:.18s ease;
      }

      .p2p-tab.active{
        background:linear-gradient(135deg,#228B22,#16a34a);
        color:white;
        border-color:rgba(74,222,128,.42);
        box-shadow:0 12px 30px rgba(34,139,34,.18);
      }

      .p2p-fee-row{
        display:grid;
        grid-template-columns:110px 1fr;
        gap:10px;
        margin-top:12px;
      }

      .p2p-fee-box{
        display:flex;
        align-items:center;
        gap:8px;
        border:1px solid rgba(34,139,34,.28);
        color:#86efac;
        background:rgba(15,23,42,.74);
        border-radius:14px;
        padding:10px;
        font-weight:950;
      }

      .p2p-result-grid{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:14px;
      }

      .p2p-result-grid.inline{
        grid-template-columns:1fr 1fr;
        gap:12px;
        margin-top:12px;
      }

      .p2p-result-grid.inline .p2p-result-card{
        padding:14px;
        min-height:120px;
      }

      .p2p-result-grid.inline .p2p-result-value{
        font-size:22px;
      }

      .p2p-final-capital-card.inline{
        margin-top:12px;
        padding:18px;
        border-radius:18px;
        text-align:left;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-label{
        font-size:12px;
        margin-bottom:8px;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-value{
        font-size:34px;
      }

      .p2p-result-card{
        border:1px solid rgba(148,163,184,.16);
        background:
          radial-gradient(circle at top left, rgba(34,139,34,.10), transparent 35%),
          linear-gradient(180deg,rgba(15,23,42,.86),rgba(2,6,23,.94));
        border-radius:18px;
        padding:16px;
      }

      .p2p-result-card.main{
        border-color:rgba(34,197,94,.25);
      }

      .p2p-result-card.warning{
        border-color:rgba(245,158,11,.35);
      }

      .p2p-result-label{
        color:#8aa0ba;
        font-size:13px;
        font-weight:900;
        margin-bottom:10px;
      }

      .p2p-result-value{
        font-size:24px;
        font-weight:950;
        color:#f8fafc;
      }

      .p2p-result-value.green{
        color:#34d399;
      }

      .p2p-result-value.onze{
        color:#4ade80;
      }

      .p2p-result-value.yellow{
        color:#f59e0b;
      }

      .p2p-small{
        color:#8aa0ba;
        font-size:12px;
        margin-top:7px;
        font-weight:800;
      }

      .p2p-final-capital-card{
        margin-top:16px;
        border:1px solid rgba(34,139,34,.26);
        background:
          radial-gradient(circle at center, rgba(34,139,34,.14), transparent 42%),
          linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,22,37,.98));
        border-radius:22px;
        padding:26px;
        text-align:center;
      }

      .p2p-final-capital-label{
        color:#a8b3c7;
        font-size:14px;
        font-weight:950;
        letter-spacing:.18em;
        text-transform:uppercase;
        margin-bottom:12px;
      }

      .p2p-final-capital-value{
        font-size:56px;
        line-height:1;
        font-weight:950;
        color:#f8fafc;
      }

      .p2p-final-capital-value span{
        color:#4ade80;
        font-size:.48em;
        margin-left:8px;
      }

      .p2p-projection-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:14px;
      }

      .p2p-projection-card{
        border:1px solid rgba(148,163,184,.16);
        background:linear-gradient(135deg,rgba(15,23,42,.88),rgba(2,6,23,.96));
        border-radius:20px;
        padding:18px;
        min-height:120px;
      }

      .p2p-projection-card.week{
        border-color:rgba(34,197,94,.22);
        background:linear-gradient(135deg,rgba(34,139,34,.13),rgba(2,6,23,.96));
      }

      .p2p-projection-card.month{
        border-color:rgba(34,139,34,.34);
        background:linear-gradient(135deg,rgba(34,139,34,.18),rgba(2,6,23,.96));
      }

      .p2p-projection-top{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        margin-bottom:18px;
      }

      .p2p-days-pill{
        padding:5px 10px;
        border-radius:999px;
        border:1px solid rgba(34,139,34,.25);
        background:rgba(34,139,34,.12);
        color:#86efac;
        font-size:12px;
        font-weight:950;
      }

      .p2p-projection-title{
        font-size:19px;
        font-weight:950;
        color:#f8fafc;
      }

      .p2p-projection-value{
        font-size:32px;
        font-weight:950;
        color:#f8fafc;
      }

      .p2p-projection-value.green{
        color:#34d399;
      }

      .p2p-projection-percent{
        color:#8aa0ba;
        font-weight:800;
        margin-top:8px;
      }

      /* Compactar resultados dentro del motor P2P */
      .p2p-result-grid.inline{
        grid-template-columns:1fr 1fr;
        gap:10px;
        margin-top:10px;
      }

      .p2p-result-grid.inline .p2p-result-card{
        padding:11px 12px;
        min-height:88px;
        border-radius:15px;
      }

      .p2p-result-grid.inline .p2p-result-label{
        font-size:11px;
        line-height:1.15;
        margin-bottom:6px;
      }

      .p2p-result-grid.inline .p2p-result-value{
        font-size:20px;
        line-height:1.05;
      }

      .p2p-result-grid.inline .p2p-small{
        font-size:10.5px;
        line-height:1.2;
        margin-top:6px;
      }

      .p2p-final-capital-card.inline{
        margin-top:10px;
        padding:13px 16px;
        border-radius:15px;
        min-height:auto;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-label{
        font-size:10.5px;
        letter-spacing:.14em;
        margin-bottom:7px;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-value{
        font-size:32px;
        line-height:1;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-value span{
        font-size:.44em;
      }

      .p2p-trade-card:has(#p2pFinalCapital){
        padding:14px;
      }

      /* ONZE P2P resultados ultra compactos */
      .p2p-trade-card:has(#p2pFinalCapital){
        padding:12px !important;
        border-radius:16px !important;
      }

      .p2p-trade-card:has(#p2pFinalCapital) .p2p-label{
        font-size:16px !important;
        margin-bottom:0 !important;
        line-height:1.15 !important;
      }

      #p2pSummaryText{
        font-size:11px !important;
        margin-top:4px !important;
        line-height:1.2 !important;
      }

      #p2pModePill,
      #p2pCompoundPill{
        font-size:10px !important;
        padding:4px 8px !important;
        line-height:1 !important;
      }

      .p2p-result-grid.inline{
        grid-template-columns:1fr 1fr !important;
        gap:8px !important;
        margin-top:8px !important;
      }

      .p2p-result-grid.inline .p2p-result-card{
        padding:9px 10px !important;
        min-height:68px !important;
        border-radius:13px !important;
      }

      .p2p-result-grid.inline .p2p-result-label{
        font-size:10px !important;
        line-height:1.15 !important;
        margin-bottom:5px !important;
      }

      .p2p-result-grid.inline .p2p-result-value{
        font-size:18px !important;
        line-height:1 !important;
        white-space:nowrap !important;
      }

      .p2p-result-grid.inline .p2p-small{
        display:none !important;
      }

      .p2p-final-capital-card.inline{
        margin-top:8px !important;
        padding:10px 12px !important;
        border-radius:13px !important;
        display:flex !important;
        align-items:center !important;
        justify-content:space-between !important;
        gap:12px !important;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-label{
        font-size:10px !important;
        letter-spacing:.12em !important;
        margin-bottom:0 !important;
        white-space:nowrap !important;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-value{
        font-size:28px !important;
        line-height:1 !important;
        text-align:right !important;
        white-space:nowrap !important;
      }

      .p2p-final-capital-card.inline .p2p-final-capital-value span{
        font-size:13px !important;
        margin-left:6px !important;
      }

      /* Compactar controles superiores P2P */
      .p2p-block:has(#p2pCapital){
        padding:14px !important;
      }

      .p2p-block:has(#p2pCapital) > div[style*="grid-template-columns"]{
        gap:10px !important;
        margin-bottom:10px !important;
      }

      .p2p-block:has(#p2pCapital) .p2p-label{
        font-size:14px !important;
        line-height:1.15 !important;
        margin-bottom:6px !important;
      }

      .p2p-block:has(#p2pCapital) .p2p-input,
      .p2p-block:has(#p2pCapital) .p2p-select{
        padding:10px 12px !important;
        min-height:44px !important;
        font-size:14px !important;
        border-radius:12px !important;
      }

      .p2p-block:has(#p2pCapital) div[style*="margin-bottom:14px"]{
        margin-bottom:10px !important;
      }

      #p2pFeeLabel{
        font-size:14px !important;
        line-height:1.15 !important;
      }

      .p2p-block:has(#p2pCapital) .p2p-toggle{
        gap:8px !important;
        margin-bottom:8px !important;
      }

      .p2p-block:has(#p2pCapital) .p2p-tab{
        padding:10px !important;
        min-height:42px !important;
        font-size:13px !important;
        border-radius:12px !important;
      }

      .p2p-block:has(#p2pCapital) .p2p-trade-card{
        margin-top:10px !important;
      }

      /* Unificar verde ONZE P2P al tono de resultados */
      #view-p2p-calculator{
        --p2p-green:#34d399;
        --p2p-green-dark:#10b981;
        --p2p-green-soft:rgba(52,211,153,.14);
        --p2p-green-border:rgba(52,211,153,.32);
      }

      #view-p2p-calculator .p2p-tab.active{
        background:linear-gradient(135deg,var(--p2p-green-dark),var(--p2p-green)) !important;
        color:#052e2b !important;
        border-color:var(--p2p-green-border) !important;
        box-shadow:0 12px 30px rgba(52,211,153,.18) !important;
      }

      #view-p2p-calculator .pill.green,
      #view-p2p-calculator .p2p-days-pill{
        background:var(--p2p-green-soft) !important;
        border-color:var(--p2p-green-border) !important;
        color:var(--p2p-green) !important;
      }

      #view-p2p-calculator .p2p-result-value.green,
      #view-p2p-calculator .p2p-result-value.onze,
      #view-p2p-calculator .p2p-projection-value.green,
      #view-p2p-calculator .p2p-fee-box,
      #view-p2p-calculator .p2p-final-capital-value span{
        color:var(--p2p-green) !important;
      }

      #view-p2p-calculator .p2p-result-card.main,
      #view-p2p-calculator .p2p-final-capital-card.inline,
      #view-p2p-calculator .p2p-projection-card.week,
      #view-p2p-calculator .p2p-projection-card.month,
      #view-p2p-calculator .p2p-trade-card.sell,
      #view-p2p-calculator .p2p-fee-box{
        border-color:var(--p2p-green-border) !important;
      }

      #view-p2p-calculator .p2p-hero{
        border-color:rgba(52,211,153,.22) !important;
        background:
          radial-gradient(circle at top left, rgba(52,211,153,.12), transparent 34%),
          linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,22,37,.98)) !important;
      }

      #view-p2p-calculator .p2p-block,
      #view-p2p-calculator .p2p-trade-card,
      #view-p2p-calculator .p2p-final-capital-card.inline{
        box-shadow:none !important;
      }

      #view-p2p-calculator .p2p-input:focus,
      #view-p2p-calculator .p2p-select:focus{
        border-color:var(--p2p-green-border) !important;
        box-shadow:0 0 0 3px rgba(52,211,153,.13) !important;
      }

      @media(max-width:980px){
        .p2p-layout,
        .p2p-result-grid,
        .p2p-projection-grid{
          grid-template-columns:1fr;
        }

        .p2p-fee-row{
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function buildP2PSection(){
    if(document.getElementById("view-p2p-calculator")) return;

    const section = document.createElement("section");
    section.className = "view";
    section.id = "view-p2p-calculator";

    section.innerHTML = `
      <section class="section-card">
        <div class="section-top" style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div>
            <h2 class="section-title">Calculadora P2P</h2>
            <p class="section-text">Simula ciclos P2P en Chile/CLP con comisiones Binance, capital y reinversión.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="pill green">Binance P2P</span>
            <span class="pill green">Super admin</span>
          </div>
        </div>

        <div class="p2p-hero" style="margin-top:18px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
            <div>
              <h3 class="section-title" style="margin-bottom:8px;">Motor de Rentabilidad P2P</h3>
              <p class="section-text">Compra, venta, comisiones, ciclos y proyección en una sola vista.</p>
            </div>
            <div style="text-align:right;">
              <div class="dash-label">Nivel Binance</div>
              <div class="dash-value" id="p2pHeaderFee" style="font-size:20px;">Oro · 0.12%</div>
            </div>
          </div>

          <div class="p2p-layout">
            <div class="p2p-block">
              <div class="p2p-trade-card sell">
                <div class="p2p-label">Precio de Venta (CLP/USDT)</div>

                <div class="p2p-toggle">
                  <button class="p2p-tab active" type="button" data-p2p-sell-fee="maker">Maker <span data-p2p-sell-maker-label>0.12%</span></button>
                  <button class="p2p-tab" type="button" data-p2p-sell-fee="taker">Taker 0%</button>
                </div>

                <input class="p2p-input" id="p2pSellPrice" value="950" inputmode="decimal" placeholder="Ej: 950">

                <div class="p2p-fee-row">
                  <div class="p2p-fee-box">
                    <input class="p2p-input" id="p2pChargeFee" value="0" inputmode="decimal" style="padding:8px;text-align:center;">
                    <span>%</span>
                  </div>
                  <input class="p2p-input" id="p2pChargeFeeNote" placeholder="Comisión adicional de cobro">
                </div>
              </div>

              <div class="p2p-trade-card buy">
                <div class="p2p-label">Precio de Compra (CLP/USDT)</div>

                <div class="p2p-toggle">
                  <button class="p2p-tab active" type="button" data-p2p-buy-fee="maker">Maker <span data-p2p-buy-maker-label>0.12%</span></button>
                  <button class="p2p-tab" type="button" data-p2p-buy-fee="taker">Taker 0%</button>
                </div>

                <input class="p2p-input" id="p2pBuyPrice" value="940" inputmode="decimal" placeholder="Ej: 940">

                <div class="p2p-fee-row">
                  <div class="p2p-fee-box">
                    <input class="p2p-input" id="p2pPayFee" value="0" inputmode="decimal" style="padding:8px;text-align:center;">
                    <span>%</span>
                  </div>
                  <input class="p2p-input" id="p2pPayFeeNote" placeholder="Comisión adicional de pago">
                </div>
              </div>
            </div>

            <div class="p2p-block">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div>
                  <div class="p2p-label">Capital Inicial (USDT)</div>
                  <input class="p2p-input" id="p2pCapital" value="1000" inputmode="decimal">
                </div>

                <div>
                  <div class="p2p-label"># Ciclos</div>
                  <input class="p2p-input" id="p2pCycles" value="5" inputmode="numeric">
                </div>
              </div>

              <div style="margin-bottom:14px;">
                <div class="p2p-label">
                  <span>Nivel de Comerciante</span>
                  <span id="p2pFeeLabel" style="display:none;"></span>
                </div>

                <select class="p2p-select" id="p2pLevel">
                  <option value="sin_comision">Sin comisión (0%)</option>
                  <option value="no_verificado">No verificado (0.20%)</option>
                  <option value="bronce">Bronce (0.175%)</option>
                  <option value="plata">Plata (0.14%)</option>
                  <option value="oro" selected>Oro (0.12%)</option>
                </select>
              </div>

              <div>
                <div class="p2p-label">Composición de Ganancias</div>
                <div class="p2p-toggle">
                  <button class="p2p-tab active" type="button" data-p2p-compound="compound">Compuesto</button>
                  <button class="p2p-tab" type="button" data-p2p-compound="simple">Simple</button>
                </div>
              </div>

              <div class="p2p-trade-card" style="margin-top:14px;margin-bottom:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
                  <div>
                    <div class="p2p-label" style="margin-bottom:2px;">Resultados del Cálculo</div>

                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <span class="pill green" id="p2pModePill">Maker + Maker</span>
                    <span class="pill" id="p2pCompoundPill">Compuesto</span>
                  </div>
                </div>

                <div class="p2p-result-grid inline">
                  <div class="p2p-result-card">
                    <div class="p2p-result-label">Ganancia por Ciclo</div>
                    <div class="p2p-result-value green" id="p2pProfitCycle">0.00 USDT</div>

                  </div>

                  <div class="p2p-result-card main">
                    <div class="p2p-result-label">Ganancia Total</div>
                    <div class="p2p-result-value green" id="p2pProfitTotal">0.00 USDT</div>

                  </div>

                  <div class="p2p-result-card">
                    <div class="p2p-result-label">% Ganancia Total</div>
                    <div class="p2p-result-value onze" id="p2pProfitPercent">0.00%</div>

                  </div>

                  <div class="p2p-result-card warning">
                    <div class="p2p-result-label">Precio Breakeven</div>
                    <div class="p2p-result-value yellow" id="p2pBreakeven">0.00</div>

                  </div>
                </div>

                <div class="p2p-final-capital-card inline">
                  <div class="p2p-final-capital-label">Capital Final</div>
                  <div class="p2p-final-capital-value" id="p2pFinalCapital">0.00 <span>USDT</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>


        <div class="p2p-hero" style="margin-top:18px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="width:34px;height:34px;border-radius:12px;border:1px solid rgba(34,139,34,.35);display:grid;place-items:center;color:#86efac;">📈</div>
            <h3 class="section-title">Proyección de Ganancias</h3>
          </div>

          <p class="section-text" style="margin-bottom:18px;">Proyección basada en operación diaria continua de tu estrategia.</p>

          <div class="p2p-projection-grid">
            <div class="p2p-projection-card">
              <div class="p2p-projection-top">
                <div class="p2p-projection-title">Por Día</div>
                <div class="p2p-days-pill">1 día</div>
              </div>
              <div class="p2p-projection-value" id="p2pDayProfit">0.00 USDT</div>
              <div class="p2p-projection-percent" id="p2pDayPercent">0.00% ganancia</div>
            </div>

            <div class="p2p-projection-card week">
              <div class="p2p-projection-top">
                <div class="p2p-projection-title">Por Semana</div>
                <div class="p2p-days-pill">7 días</div>
              </div>
              <div class="p2p-projection-value green" id="p2pWeekProfit">0.00 USDT</div>
              <div class="p2p-projection-percent" id="p2pWeekPercent">0.00% ganancia</div>
            </div>

            <div class="p2p-projection-card month">
              <div class="p2p-projection-top">
                <div class="p2p-projection-title">Por Mes</div>
                <div class="p2p-days-pill">30 días</div>
              </div>
              <div class="p2p-projection-value green" id="p2pMonthProfit">0.00 USDT</div>
              <div class="p2p-projection-percent" id="p2pMonthPercent">0.00% ganancia</div>
            </div>
          </div>
        </div>
      </section>
    `;

    const lastView = document.querySelector(".view:last-of-type");
    if(lastView && lastView.parentNode){
      lastView.parentNode.insertBefore(section, lastView.nextSibling);
    }else{
      document.body.appendChild(section);
    }
  }

  function addP2PNavButton(){
    if(document.querySelector('[data-view-target="p2p-calculator"]')) return;

    const calcBtn = document.querySelector('[data-view-target="calculadora"]');
    if(!calcBtn || !calcBtn.parentNode) return;

    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.type = "button";
    btn.dataset.viewTarget = "p2p-calculator";
    btn.textContent = "Calculadora P2P";

    calcBtn.parentNode.insertBefore(btn, calcBtn.nextSibling);

    btn.addEventListener("click", function(){
      if(typeof switchView === "function"){
        switchView("p2p-calculator");
      }else{
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        document.getElementById("view-p2p-calculator")?.classList.add("active");
      }

      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      calculateP2P();
    });
  }

  let p2pSellFeeMode = "maker";
  let p2pBuyFeeMode = "maker";
  let p2pCompoundMode = "compound";

  function getNumber(id){
    const el = document.getElementById(id);
    if(!el) return 0;

    const raw = String(el.value || "0")
      .replace(/\./g, "")
      .replace(",", ".");

    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function currentBinanceFee(){
    const level = document.getElementById("p2pLevel")?.value || "oro";

    if(level === "personalizado"){
      return getNumber("p2pCustomFee");
    }

    return getFeeFromLevel(level);
  }

  function calculateP2P(){
    const sellPrice = getNumber("p2pSellPrice");
    const buyPrice = getNumber("p2pBuyPrice");
    const capital = getNumber("p2pCapital");
    const cycles = Math.max(1, Math.floor(getNumber("p2pCycles") || 1));
    const chargeFee = getNumber("p2pChargeFee");
    const payFee = getNumber("p2pPayFee");

    const binanceFeePct = currentBinanceFee();

    const sellBinanceFee = p2pSellFeeMode === "maker" ? binanceFeePct : 0;
    const buyBinanceFee = p2pBuyFeeMode === "maker" ? binanceFeePct : 0;

    const totalSellFeePct = sellBinanceFee + chargeFee;
    const totalBuyFeePct = buyBinanceFee + payFee;

    const fiatAfterSell = capital * sellPrice * (1 - totalSellFeePct / 100);
    const usdtAfterBuy = buyPrice > 0 ? (fiatAfterSell / buyPrice) * (1 - totalBuyFeePct / 100) : 0;

    const profitPerCycle = usdtAfterBuy - capital;
    const profitPctCycle = capital > 0 ? profitPerCycle / capital : 0;

    let finalCapital = capital;
    let totalProfit = 0;

    if(p2pCompoundMode === "compound"){
      for(let i = 0; i < cycles; i++){
        finalCapital = finalCapital * (1 + profitPctCycle);
      }
      totalProfit = finalCapital - capital;
    }else{
      totalProfit = profitPerCycle * cycles;
      finalCapital = capital + totalProfit;
    }

    const totalProfitPct = capital > 0 ? (totalProfit / capital) * 100 : 0;

    const totalFeeFactor = (1 - totalSellFeePct / 100) * (1 - totalBuyFeePct / 100);
    const breakeven = totalFeeFactor > 0 ? buyPrice / totalFeeFactor : 0;

    const feeLabel = document.getElementById("p2pFeeLabel");
    if(feeLabel) feeLabel.textContent = "";

    const headerFee = document.getElementById("p2pHeaderFee");
    const levelText = document.getElementById("p2pLevel")?.selectedOptions?.[0]?.textContent || "Nivel";
    if(headerFee) headerFee.textContent = levelText;

    document.querySelectorAll("[data-p2p-sell-maker-label]").forEach(el => el.textContent = `${money(binanceFeePct, 3)}%`);
    document.querySelectorAll("[data-p2p-buy-maker-label]").forEach(el => el.textContent = `${money(binanceFeePct, 3)}%`);

    const modeLabel = `${p2pSellFeeMode === "maker" ? `Maker ${money(binanceFeePct, 3)}%` : "Taker 0%"} + ${p2pBuyFeeMode === "maker" ? `Maker ${money(binanceFeePct, 3)}%` : "Taker 0%"}`;
    const shortModeLabel = `${p2pSellFeeMode === "maker" ? "Maker" : "Taker"} + ${p2pBuyFeeMode === "maker" ? "Maker" : "Taker"}`;
    const compoundLabel = p2pCompoundMode === "compound" ? "Compuesto" : "Simple";

    const modePill = document.getElementById("p2pModePill");
    const compoundPill = document.getElementById("p2pCompoundPill");
    const summaryText = document.getElementById("p2pSummaryText");

    if(modePill) modePill.textContent = shortModeLabel;
    if(compoundPill) compoundPill.textContent = compoundLabel;
    if(summaryText) summaryText.textContent = "";

    const dayProfit = profitPerCycle;
    const weekProfit = p2pCompoundMode === "compound"
      ? capital * (Math.pow(1 + profitPctCycle, 7) - 1)
      : profitPerCycle * 7;
    const monthProfit = p2pCompoundMode === "compound"
      ? capital * (Math.pow(1 + profitPctCycle, 30) - 1)
      : profitPerCycle * 30;

    const dayPct = capital > 0 ? (dayProfit / capital) * 100 : 0;
    const weekPct = capital > 0 ? (weekProfit / capital) * 100 : 0;
    const monthPct = capital > 0 ? (monthProfit / capital) * 100 : 0;

    document.getElementById("p2pProfitCycle").textContent = `${profitPerCycle >= 0 ? "" : "-"}${money(Math.abs(profitPerCycle), 2)} USDT`;
    document.getElementById("p2pProfitTotal").textContent = `${totalProfit >= 0 ? "+" : "-"}${money(Math.abs(totalProfit), 2)} USDT`;
    document.getElementById("p2pProfitPercent").textContent = pct(totalProfitPct);
    document.getElementById("p2pBreakeven").textContent = money(breakeven, 2);

    const finalCapitalEl = document.getElementById("p2pFinalCapital");
    if(finalCapitalEl){
      finalCapitalEl.innerHTML = `${money(finalCapital, 2)} <span>USDT</span>`;
    }

    const dayProfitEl = document.getElementById("p2pDayProfit");
    const weekProfitEl = document.getElementById("p2pWeekProfit");
    const monthProfitEl = document.getElementById("p2pMonthProfit");
    const dayPercentEl = document.getElementById("p2pDayPercent");
    const weekPercentEl = document.getElementById("p2pWeekPercent");
    const monthPercentEl = document.getElementById("p2pMonthPercent");

    if(dayProfitEl) dayProfitEl.textContent = `${dayProfit >= 0 ? "" : "-"}${money(Math.abs(dayProfit), 2)} USDT`;
    if(weekProfitEl) weekProfitEl.textContent = `${weekProfit >= 0 ? "" : "-"}${money(Math.abs(weekProfit), 2)} USDT`;
    if(monthProfitEl) monthProfitEl.textContent = `${monthProfit >= 0 ? "" : "-"}${money(Math.abs(monthProfit), 2)} USDT`;

    if(dayPercentEl) dayPercentEl.textContent = `${pct(dayPct)} ganancia`;
    if(weekPercentEl) weekPercentEl.textContent = `${pct(weekPct)} ganancia`;
    if(monthPercentEl) monthPercentEl.textContent = `${pct(monthPct)} ganancia`;
  }

  function attachP2PEvents(){
    document.querySelectorAll("[data-p2p-sell-fee]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        p2pSellFeeMode = btn.dataset.p2pSellFee;
        document.querySelectorAll("[data-p2p-sell-fee]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        calculateP2P();
      });
    });

    document.querySelectorAll("[data-p2p-buy-fee]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        p2pBuyFeeMode = btn.dataset.p2pBuyFee;
        document.querySelectorAll("[data-p2p-buy-fee]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        calculateP2P();
      });
    });

    document.querySelectorAll("[data-p2p-compound]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        p2pCompoundMode = btn.dataset.p2pCompound;
        document.querySelectorAll("[data-p2p-compound]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        calculateP2P();
      });
    });

    [
      "p2pSellPrice",
      "p2pBuyPrice",
      "p2pCapital",
      "p2pCycles",
      "p2pChargeFee",
      "p2pPayFee",
      "p2pLevel"
    ].forEach(id=>{
      document.getElementById(id)?.addEventListener("input", calculateP2P);
      document.getElementById(id)?.addEventListener("change", calculateP2P);
    });
  }

  function initP2PCalculator(){
    addP2PStyles();
    buildP2PSection();
    addP2PNavButton();
    attachP2PEvents();
    calculateP2P();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initP2PCalculator);
  }else{
    initP2PCalculator();
  }
})();
