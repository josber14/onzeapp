
/* ===== ONZE: Dashboard P2P Super Admin ===== */
(function(){
  if(window.__onzeP2PDashboardLoaded) return;
  window.__onzeP2PDashboardLoaded = true;

  function isOnzeSuperAdminForP2PDashboard(){
    try{
      if(typeof IS_ADMIN_ROLE !== "undefined" && IS_ADMIN_ROLE) return true;
      if(window.currentUserContext?.role === "super_admin_global" || window.currentUserContext?.role === "super_admin_cliente") return true;
      if(document.body.classList.contains("onze-admin-visible")) return true;

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

        if(role.includes("super") || role.includes("admin") || email.includes("josber")){
          return true;
        }
      }

      if(document.body.innerText.includes("Ir a admin")) return true;
    }catch(e){}

    return false;
  }

  function addP2PDashboardStyles(){
    if(document.getElementById("onzeP2PDashboardStyles")) return;

    const style = document.createElement("style");
    style.id = "onzeP2PDashboardStyles";
    style.textContent = `
      #view-p2p-dashboard{
        --p2p-green:#34d399;
        --p2p-green-soft:rgba(52,211,153,.13);
        --p2p-green-border:rgba(52,211,153,.28);
      }

      .p2p-dashboard-hero{
        border:1px solid var(--p2p-green-border);
        background:
          radial-gradient(circle at top left, rgba(52,211,153,.13), transparent 35%),
          linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,22,37,.98));
        border-radius:26px;
        padding:22px;
      }

      .p2p-dashboard-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:14px;
        margin-top:18px;
      }

      .p2p-dashboard-card{
        border:1px solid rgba(148,163,184,.16);
        background:linear-gradient(180deg,rgba(15,23,42,.86),rgba(2,6,23,.94));
        border-radius:18px;
        padding:16px;
        min-height:118px;
      }

      .p2p-dashboard-card.main{
        border-color:var(--p2p-green-border);
        background:
          radial-gradient(circle at top left, rgba(52,211,153,.12), transparent 40%),
          linear-gradient(180deg,rgba(15,23,42,.88),rgba(2,6,23,.96));
      }

      .p2p-dashboard-label{
        color:#8aa0ba;
        font-size:13px;
        font-weight:900;
        margin-bottom:10px;
      }

      .p2p-dashboard-value{
        color:#f8fafc;
        font-size:28px;
        font-weight:950;
        line-height:1.15;
        overflow-wrap:anywhere;
      }

      .p2p-dashboard-value.green{
        color:var(--p2p-green);
      }

      .p2p-dashboard-small{
        color:#8aa0ba;
        font-size:12px;
        font-weight:800;
        margin-top:8px;
      }

      .p2p-dashboard-two{
        display:grid;
        grid-template-columns:1fr;
        gap:16px;
        margin-top:18px;
      }

      .p2p-dashboard-panel{
        border:1px solid rgba(148,163,184,.16);
        background:rgba(15,23,42,.62);
        border-radius:22px;
        padding:18px;
      }

      .p2p-dashboard-empty{
        border:1px dashed rgba(148,163,184,.22);
        border-radius:16px;
        padding:18px;
        color:#8aa0ba;
        font-weight:800;
        text-align:center;
        background:rgba(2,6,23,.34);
      }

      @media(max-width:980px){
        .p2p-dashboard-grid,
        .p2p-dashboard-two{
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function buildP2PDashboardView(){
    if(document.getElementById("view-p2p-dashboard")) return;

    const section = document.createElement("section");
    section.className = "view admin-only-view";
    section.id = "view-p2p-dashboard";

    section.innerHTML = `
      <section class="section-card">
        <div class="section-top" style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div>
            <h2 class="section-title">Dashboard P2P</h2>

          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <span class="pill green">P2P independiente</span>
            <span class="pill green">Super admin</span>
          </div>
        </div>

        <div class="p2p-dashboard-hero" style="margin-top:18px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
            <div>
              <h3 class="section-title" style="margin-bottom:8px;">Resumen P2P</h3>
              <div style="display:flex;gap:6px;margin-top:10px;">
                <button type="button" id="p2pResumenTabBinance" class="p2p-resumen-tab active" onclick="window.setP2PResumenExchange('binance')">Binance</button>
                <button type="button" id="p2pResumenTabBybit" class="p2p-resumen-tab" onclick="window.setP2PResumenExchange('bybit')">Bybit</button>
                <button type="button" id="p2pResumenTabOkx" class="p2p-resumen-tab" onclick="window.setP2PResumenExchange('okx')">OKX</button>
                <button type="button" id="p2pResumenTabTotal" class="p2p-resumen-tab" onclick="window.setP2PResumenExchange('all')">Total</button>
              </div>
            </div>
            <button class="onze-metric-icon-btn" type="button" id="btn-p2p-detail-main" onclick="openP2PRangeDetailModal('today', window.__p2pResumenExchange || 'binance')" title="Ver métricas P2P" aria-label="Ver métricas P2P"><svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16V11"/><path d="M12 16V8"/><path d="M16 16V6"/><path d="M20 16V13"/></svg></button>
          </div>

          <div class="p2p-dashboard-grid p2p-dashboard-grid-centered">
            <div class="p2p-dashboard-card main">
              <div class="p2p-dashboard-label" id="p2pDashCapitalLabel">USDT vendidos Binance</div>
              <div class="p2p-dashboard-value green" id="p2pDashCapital">0.00 USDT</div>

            </div>

            <div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label" id="p2pDashProfitTodayLabel">CLP recibido Binance</div>
              <div class="p2p-dashboard-value green" id="p2pDashProfitToday">0 CLP</div>
            </div>

            <div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label">Ganancia real P2P</div>
              <div class="p2p-dashboard-value green" id="p2pDashProfitMonth">Pendiente</div>
            </div>

            <div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label">Capital P2P</div>
              <div class="p2p-dashboard-value green" id="p2pDashVolume">0.00 USDT</div>
              <div class="p2p-dashboard-small" id="p2pDashVolumeSub" onclick="setP2PInitialCapital()" style="cursor:pointer;">Inicial: 0.00 USDT · Resultado: +0.00 USDT</div>
            </div>

            <div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label">Ventas completadas</div>
              <div class="p2p-dashboard-value" id="p2pDashCycles">0</div>
            </div>

            <div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label">Precio venta promedio</div>
              <div class="p2p-dashboard-value green" id="p2pDashAvgProfit">0 CLP</div>
              <div class="p2p-dashboard-small" id="p2pDashAvgProfitSub">Rentabilidad: 0,00%</div>
            </div>
          </div>
        </div>

        <div class="p2p-dashboard-two">
          <div class="p2p-dashboard-panel">
            <h3 class="section-title" style="margin-bottom:8px;">Capacity externo P2P</h3>
            <p class="section-text" style="margin-bottom:14px;">Aquí registraremos proveedor, cupo, precio de compra, pagos realizados y saldo pendiente.</p>
            <div class="p2p-dashboard-empty">Pendiente: registrar capacity externo.</div>
          </div>

          <div class="p2p-dashboard-panel">
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
              <div style="display:flex;gap:6px;">
                <button type="button" id="p2pVentasTabBinance" class="p2p-resumen-tab active" onclick="window.setP2PVentasExchange('binance')">Ventas Binance</button>
                <button type="button" id="p2pVentasTabBybit" class="p2p-resumen-tab" onclick="window.setP2PVentasExchange('bybit')">Ventas Bybit</button>
                <button type="button" id="p2pVentasTabOkx" class="p2p-resumen-tab" onclick="window.setP2PVentasExchange('okx')">Ventas OKX</button>
              </div>
              <div id="p2pVentasBinanceControls" style="margin-left:auto;display:flex;gap:6px;align-items:center;">
                <button id="btn-sync-binance-sales" class="btn secondary" type="button" style="padding:4px 8px;font-size:12px;line-height:1.2;" title="Sincronizar Binance P2P">🔄</button>
                <button id="btn-manual-sale" class="btn secondary" type="button" style="padding:4px 8px;font-size:12px;line-height:1.2;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.25);color:#fbbf24;">✚ manual</button>
                <span id="manual-sales-badge" style="display:none;cursor:pointer;color:#94a3b8;font-size:13px;padding:4px 7px;border:1px solid rgba(148,163,184,.15);border-radius:8px;background:rgba(148,163,184,.06);white-space:nowrap;">📋</span>
              </div>
              <div id="p2pVentasBybitControls" style="margin-left:auto;display:none;gap:6px;align-items:center;">
                <button id="btn-sync-bybit-sales" class="btn secondary" type="button" style="padding:4px 8px;font-size:12px;line-height:1.2;" title="Sincronizar Bybit P2P">🔄</button>
                <button id="btn-manual-sale-bybit" class="btn secondary" type="button" style="padding:4px 8px;font-size:12px;line-height:1.2;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.25);color:#fbbf24;">✚ manual</button>
              </div>
              <div id="p2pVentasOkxControls" style="margin-left:auto;display:none;gap:6px;align-items:center;">
                <button id="btn-manual-sale-okx" class="btn secondary" type="button" style="padding:4px 8px;font-size:12px;line-height:1.2;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.25);color:#fbbf24;">✚ manual</button>
              </div>
            </div>
            <div id="binance-sales-container" class="p2p-dashboard-empty" style="margin-top:14px;">Sin operaciones P2P registradas todavía.</div>
            <div id="bybit-sales-container" class="p2p-dashboard-empty" style="margin-top:14px;display:none;">Sin operaciones Bybit registradas todavía.</div>
            <div id="okx-sales-container" class="p2p-dashboard-empty" style="margin-top:14px;display:none;">Sin operaciones OKX registradas todavía. OKX solo admite ventas manuales por ahora.</div>
          </div>
        </div>
      </section>
    `;

    const p2pCalcView = document.getElementById("view-p2p-calculator");
    if(p2pCalcView && p2pCalcView.parentNode){
      p2pCalcView.parentNode.insertBefore(section, p2pCalcView.nextSibling);
    }else{
      const lastView = document.querySelector(".view:last-of-type");
      if(lastView && lastView.parentNode){
        lastView.parentNode.insertBefore(section, lastView.nextSibling);
      }else{
        document.body.appendChild(section);
      }
    }
  }

  function addP2PDashboardNavButton(){
    if(document.querySelector('[data-view-target="p2p-dashboard"]')) return;

    const p2pCalcBtn = document.querySelector('[data-view-target="p2p-calculator"]');
    const calcBtn = document.querySelector('[data-view-target="calculadora"]');
    const anchor = p2pCalcBtn || calcBtn;

    if(!anchor || !anchor.parentNode) return;

    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.type = "button";
    btn.dataset.viewTarget = "p2p-dashboard";
    btn.textContent = "Dashboard P2P";

    anchor.parentNode.insertBefore(btn, anchor.nextSibling);

    btn.addEventListener("click", function(){
      if(typeof switchView === "function"){
        switchView("p2p-dashboard");
      }else{
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        document.getElementById("view-p2p-dashboard")?.classList.add("active");
      }

      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Refrescar datos del dashboard P2P al navegar
      if(typeof syncP2PCapacityFromServer === 'function') syncP2PCapacityFromServer();
      if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
      if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    });
  }

  function initP2PDashboard(){
    addP2PDashboardStyles();
    buildP2PDashboardView();
    if(isOnzeSuperAdminForP2PDashboard()){
      addP2PDashboardNavButton();
    }
    // setTimeout (no llamada directa): cleanupPhantomP2POrders se define más
    // abajo en este mismo script como asignación a window.X (no hoisted) --
    // mismo motivo por el que initBinanceSalesSync/etc. también usan 500ms,
    // para asegurar que ya esté definida cuando se llame.
    setTimeout(function(){ if(typeof window.cleanupPhantomP2POrders === "function") window.cleanupPhantomP2POrders(); }, 500);
    setTimeout(initBinanceSalesSync, 500);
    setTimeout(initBybitSalesSync, 500);
    setTimeout(initOkxSalesTab, 500);

    // Bug real confirmado en vivo (sep 2026): antes de esto, syncP2PCapacityFromServer()
    // solo corría al navegar a la pestaña Dashboard P2P -- si esa única
    // llamada fallaba (ej. el servidor tuvo un error puntual), el panel se
    // quedaba con "0 capacitys" hasta que el usuario navegara para afuera y
    // para adentro de nuevo. Ahora corre una vez al cargar y se reintenta
    // sola cada 60s de fondo -- mismo patrón que ya tienen las ventas
    // (initBinanceSalesSync/initBybitSalesSync) -- así una falla transitoria
    // se autocorrige sin que nadie tenga que hacer nada.
    setTimeout(function(){ if(typeof syncP2PCapacityFromServer === 'function') syncP2PCapacityFromServer(); }, 500);
    setInterval(function(){ if(typeof syncP2PCapacityFromServer === 'function') syncP2PCapacityFromServer(); }, 60000);

    // Ventas marcadas como "capital propio" (ver P2PCapitalMarkedSale) --
    // mismo patrón que capacity: una vez al cargar y reintento cada 60s, así
    // la marca es igual en cualquier dispositivo apenas sincroniza.
    setTimeout(function(){ if(typeof syncP2PCapitalMarkedSalesFromServer === 'function') syncP2PCapitalMarkedSalesFromServer(); }, 500);
    setInterval(function(){ if(typeof syncP2PCapitalMarkedSalesFromServer === 'function') syncP2PCapitalMarkedSalesFromServer(); }, 60000);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initP2PDashboard);
  }else{
    initP2PDashboard();
  }
})();
