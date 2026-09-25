
/* ===== ONZE: Sync Binance P2P Dashboard ===== */
(function(){
  if(window.__onzeBinanceP2PSyncLoaded) return;
  window.__onzeBinanceP2PSyncLoaded = true;

  window.p2pMoney = function p2pMoney(n, decimals = 2){
    const value = Number(n || 0);
    return value.toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  // Separado por tenant (window.__p2pTenantSuffix, fijado al inicio del
  // panel) -- ver el comentario junto a esa variable: estas claves eran
  // globales al origen onze-pay.com y una cuenta llegó a leer ventas de
  // otra, inflando y cerrando capacities que no correspondían.
  window.p2pOrdersKey = function p2pOrdersKey(base){
    return base + (window.__p2pTenantSuffix || "");
  }

  window.loadP2PBinanceOrders = function loadP2PBinanceOrders(){
    try{
      return JSON.parse(localStorage.getItem(p2pOrdersKey("onze_p2p_binance_orders")) || "[]");
    }catch(e){
      return [];
    }
  }

  window.saveP2PBinanceOrders = function saveP2PBinanceOrders(orders){
    // Mismo resguardo que saveP2PCapacity() -- en una cuenta de mucho
    // volumen (miles de ventas reales) este JSON también puede superar el
    // límite de localStorage; que falle acá nunca debe cortar al que llama.
    try{ localStorage.setItem(p2pOrdersKey("onze_p2p_binance_orders"), JSON.stringify(Array.isArray(orders) ? orders : [])); }catch(e){ console.warn('No se pudo guardar ventas Binance en localStorage (no crítico):', e.message); }
  }

  // Espejo de loadP2PBinanceOrders/saveP2PBinanceOrders para Bybit -- misma
  // forma de dato, guardado aparte para no mezclar ni arriesgar el flujo de
  // Binance que ya funciona.
  window.loadP2PBybitOrders = function loadP2PBybitOrders(){
    try{
      return JSON.parse(localStorage.getItem(p2pOrdersKey("onze_p2p_bybit_orders")) || "[]");
    }catch(e){
      return [];
    }
  }

  window.saveP2PBybitOrders = function saveP2PBybitOrders(orders){
    try{ localStorage.setItem(p2pOrdersKey("onze_p2p_bybit_orders"), JSON.stringify(Array.isArray(orders) ? orders : [])); }catch(e){ console.warn('No se pudo guardar ventas Bybit en localStorage (no crítico):', e.message); }
  }

  // Mismo espejo para OKX -- solo ventas manuales por ahora (no hay API de
  // OKX conectada todavía, ver lib/p2p-bot/okx-adapter.ts), sin comisión
  // igual que Bybit.
  window.loadP2POkxOrders = function loadP2POkxOrders(){
    try{
      return JSON.parse(localStorage.getItem(p2pOrdersKey("onze_p2p_okx_orders")) || "[]");
    }catch(e){
      return [];
    }
  }

  window.saveP2POkxOrders = function saveP2POkxOrders(orders){
    try{ localStorage.setItem(p2pOrdersKey("onze_p2p_okx_orders"), JSON.stringify(Array.isArray(orders) ? orders : [])); }catch(e){ console.warn('No se pudo guardar ventas OKX en localStorage (no crítico):', e.message); }
  }

  // Limpieza única al cargar el panel (ago 2026): borra del caché local
  // cualquier "venta" con 0 USDT/0 CLP guardada en localStorage -- no son
  // ventas reales (residuos de antes del último reinicio del módulo P2P,
  // ninguna existe en la base de datos del servidor), y ya se excluyen del
  // cálculo en calculateP2PCapacityStats(). Esto solo borra el residuo
  // físico del navegador para que no quede acumulando basura para siempre.
  // Umbral (no cero exacto): un residuo puede quedar guardado como
  // 0,0000001 USDT en vez de 0 exacto -- eso se VE como "0,00 USDT / 0 CLP"
  // en pantalla (redondeado a 2 y 0 decimales respectivamente) pero un
  // filtro de "=== 0" o "> 0" no lo detecta. Se trata como fantasma
  // cualquier valor que redondeado A LO QUE SE MUESTRA en pantalla dé cero.
  window.isP2POrderPhantom = function isP2POrderPhantom(o){
    return Math.abs(Number(o.amount || 0)) < 0.005 || Math.abs(Number(o.totalPrice || 0)) < 0.5;
  };

  window.cleanupPhantomP2POrders = function cleanupPhantomP2POrders(){
    const isReal = o => !window.isP2POrderPhantom(o);

    const binance = loadP2PBinanceOrders();
    const binanceClean = binance.filter(isReal);
    if(binanceClean.length !== binance.length) saveP2PBinanceOrders(binanceClean);

    const bybit = loadP2PBybitOrders();
    const bybitClean = bybit.filter(isReal);
    if(bybitClean.length !== bybit.length) saveP2PBybitOrders(bybitClean);

    const okx = loadP2POkxOrders();
    const okxClean = okx.filter(isReal);
    if(okxClean.length !== okx.length) saveP2POkxOrders(okxClean);
  };

  // Borra una venta manual del CICLO activo (P2PCycleManualSale en Neon) --
  // distinto de deleteManualSale de abajo, que es del sistema viejo de
  // localStorage. Pedido explícito del usuario (sep 2026): venía sin forma
  // de borrar una cargada por error (ej. duplicada) desde esta lista.
  window.deleteCycleManualSale = async function deleteCycleManualSale(id){
    if(!(await onzeConfirm("¿Borrar esta venta manual del ciclo? Se restará del total."))) return;
    try{
      const r = await fetch("/api/p2p/cycle/manual-sale?id=" + id, { method:"DELETE", credentials:"include" });
      const d = await r.json();
      if(!d?.ok){ onzeAlert(d?.error || "No se pudo borrar la venta manual."); return; }
    }catch(e){ onzeAlert("Error de conexión al borrar la venta manual."); return; }
    botCycleRefresh();
  };

  window.deleteManualSale = async function deleteManualSale(orderId){
    if(!(await onzeConfirm("¿Borrar esta venta manual? Se recalcularán las capacidades."))) return;
    const orders = loadP2PBinanceOrders();
    const filtered = orders.filter(o => o.orderNumber !== orderId);
    saveP2PBinanceOrders(filtered);
    if(typeof window.deleteP2PManualSaleFromServer === "function") window.deleteP2PManualSaleFromServer(orderId);
    // Recalcular todo desde cero para limpiar valores fantasma
    window.recalculateP2PCapacities();
  };

  window.recalculateP2PCapacities = async function recalculateP2PCapacities(){
    if(!(await onzeConfirm("¿Recalcular capacities desde cero? Se limpiarán todos los clpReceived, saleParts y estados finished para reasignar solo con ventas reales."))) return;
    const caps = loadP2PCapacity();
    for(const cap of caps){
      cap.clpReceived = "0";
      cap.usedUsdt = "0";
      cap.commissionUsdt = "0";
      cap.commissionClp = "0";
      cap.saleParts = [];
      if(cap.status === "finished"){
        cap.status = "active";
        delete cap.finishedAt;
        delete cap.finalSoldUsdt;
        delete cap.finalClpReceived;
        delete cap.finalCommissionUsdt;
        delete cap.finalCommissionClp;
        delete cap.finalSaleParts;
      }
    }
    saveP2PCapacity(caps, true);
    renderP2PCapacityPanel();
    renderP2PDashboardFromBinance();
  };

  window.__p2pBinancePage = 1;
  const __p2pBinancePageSize = 10;

  window.__p2pSalesView = 'binance'; // 'binance' | 'manual'
  window.__p2pManualPage = 1;
  const __p2pManualPageSize = 10;

  window.renderP2PDashboardFromBinance = function renderP2PDashboardFromBinance(){
    const orders = loadP2PBinanceOrders();

    const showManual = window.__p2pSalesView === 'manual';

    // En la lógica real de ONZE P2P, Binance se usa SOLO para ventas.
    // Las compras/capacity vienen de proveedor externo y se registrarán en otro módulo.
    const completedSales = orders.filter(o => {
      const status = String(o.orderStatus || "").toUpperCase();
      const type = String(o.tradeType || "").toUpperCase();
      const fiat = String(o.fiat || "").toUpperCase();
      const isManual = o._manual || String(o.orderNumber || '').startsWith('manual_');
      return status === "COMPLETED" && type === "SELL" && fiat === "CLP" && (showManual ? isManual : !isManual);
    });

    const totalUsdtSold = completedSales.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const totalClpReceived = completedSales.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);
    const totalCommissionUsdt = completedSales.reduce((sum, o) => sum + Number(o.commission || 0), 0);

    const avgSellPrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : 0;

    // Las cards resumen las actualiza updateP2PDashboardWithCapacity (basado en capacities)
    // para evitar conflictos entre dos funciones escribiendo los mismos elementos.

    const historyEmpty = Array.from(document.querySelectorAll(".p2p-dashboard-empty"))
      .find(el => el.textContent.includes("Sin operaciones P2P") || el.textContent.includes("sincronizadas") || el.closest(".p2p-dashboard-panel")?.innerText.includes("Ventas Binance"));

    if(typeof loadP2PInitialCapitalFromServer === 'function') loadP2PInitialCapitalFromServer();
    if(typeof loadP2PWithdrawalsFromServer === 'function') loadP2PWithdrawalsFromServer();
    if(typeof p2pMonthlyCapitalRollover === 'function') p2pMonthlyCapitalRollover();

    if(historyEmpty){
      if(!completedSales.length){
        historyEmpty.innerHTML = showManual
          ? '<div style="display:flex;justify-content:space-between;align-items:center;"><span style="color:#8aa0ba;">Sin ventas manuales registradas.</span><button class="btn secondary" style="padding:6px 14px;font-size:13px;" onclick="window.__p2pSalesView=\'binance\';renderP2PDashboardFromBinance();">← Volver a Ventas Binance</button></div>'
          : "Sin ventas Binance sincronizadas todavía.";
      }else{
        const pageSize = showManual ? __p2pManualPageSize : __p2pBinancePageSize;
        const pageKey = showManual ? '__p2pManualPage' : '__p2pBinancePage';
        const totalPages = Math.ceil(completedSales.length / pageSize) || 1;
        if(window[pageKey] > totalPages) window[pageKey] = totalPages;
        const startIdx = (window[pageKey] - 1) * pageSize;
        const pageSales = completedSales.slice(startIdx, startIdx + pageSize);

        historyEmpty.innerHTML = (showManual ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(148,163,184,.1);">
          <strong style="color:#f8fafc;font-size:14px;">📋 Ventas Manuales</strong>
          <button class="btn secondary" style="padding:6px 14px;font-size:13px;" onclick="window.__p2pSalesView='binance';renderP2PDashboardFromBinance();">← Volver a Ventas Binance</button>
        </div>` : "") +

        pageSales.map(o => {
          const date = o.createdAt ? new Date(o.createdAt).toLocaleString("es-CL", {
            timeZone:"America/Santiago",
            day:"2-digit",
            month:"2-digit",
            year:"numeric",
            hour:"2-digit",
            minute:"2-digit"
          }) : "";

          return `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;">
              <div>
                <strong style="color:#f8fafc;">Venta ${p2pMoney(o.amount, 2)} ${o.asset || "USDT"}</strong>
                <div style="color:#00d4ff;font-size:11px;margin-top:3px;font-family:monospace;word-break:break-all;">Orden: ${o.orderNumber || ""}</div>
                <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${date} · ${o.payMethodName || "Método no disponible"}</div>
                <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">Comisión: ${p2pMoney(o.commission, 4)} USDT</div>
              </div>
              <div style="text-align:right;">
                <strong style="color:#34d399;">${p2pMoney(o.unitPrice, 2)} ${o.fiat || "CLP"}</strong>
                <div style="color:#f8fafc;font-size:12px;margin-top:3px;">${p2pMoney(o.totalPrice, 0)} ${o.fiat || "CLP"}</div>
                <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${o.orderStatus || ""}</div>
                ${showManual ? `<div style="margin-top:4px;"><button class="btn small danger" type="button" onclick="event.stopPropagation();window.deleteManualSale('${o.orderNumber}')" title="Borrar venta manual" style="padding:2px 6px;font-size:12px;line-height:1;">🗑️</button></div>` : ""}
              </div>
            </div>
          `;
        }).join("") + `
          <div style="display:flex;justify-content:center;gap:12px;padding-top:14px;align-items:center;">
            <button class="btn secondary" style="padding:6px 12px;font-size:16px;line-height:1;" onclick="${showManual ? `window.__p2pManualPage` : `window.__p2pBinancePage`} = Math.max(1, ${showManual ? `window.__p2pManualPage` : `window.__p2pBinancePage`} - 1); renderP2PDashboardFromBinance();" ${window[pageKey] <= 1 ? 'disabled' : ''}>&larr;</button>
            <span style="color:#8aa0ba;font-size:13px;">${window[pageKey]} / ${totalPages}</span>
            <button class="btn secondary" style="padding:6px 12px;font-size:16px;line-height:1;" onclick="${showManual ? `window.__p2pManualPage` : `window.__p2pBinancePage`} = Math.min(${totalPages}, ${showManual ? `window.__p2pManualPage` : `window.__p2pBinancePage`} + 1); renderP2PDashboardFromBinance();" ${window[pageKey] >= totalPages ? 'disabled' : ''}>&rarr;</button>
          </div>
        `;
      }
    }

    const capacityBox = Array.from(document.querySelectorAll(".p2p-dashboard-empty"))
      .find(el => el.textContent.includes("capacity externo") || el.textContent.includes("Capacity externo") || el.closest(".p2p-dashboard-panel")?.innerText.includes("Capacity externo"));

    if(capacityBox && !capacityBox.dataset.readyText){
      capacityBox.dataset.readyText = "1";
      capacityBox.innerHTML = `
        <div style="text-align:left;">
          <strong style="color:#f8fafc;">Próximo paso</strong>
          <div style="color:#8aa0ba;margin-top:6px;line-height:1.35;">
            Registrar proveedor, cupo/capacity, precio de compra y pagos externos para calcular ganancia real.
          </div>
        </div>
      `;
    }

    // Actualizar badge de ventas manuales
    const allOrders = loadP2PBinanceOrders();
    const manualCount = allOrders.filter(o => {
      const status = String(o.orderStatus || "").toUpperCase();
      const type = String(o.tradeType || "").toUpperCase();
      const fiat = String(o.fiat || "").toUpperCase();
      const isManual = o._manual || String(o.orderNumber || '').startsWith('manual_');
      return status === "COMPLETED" && type === "SELL" && fiat === "CLP" && isManual;
    }).length;
    const badge = document.getElementById("manual-sales-badge");
    if(badge){
      badge.style.display = manualCount > 0 ? "inline-block" : "none";
      if(!badge.dataset.listenerAttached){
        badge.addEventListener("click", function(){
          window.__p2pSalesView = 'manual';
          window.__p2pManualPage = 1;
          renderP2PDashboardFromBinance();
        });
        badge.dataset.listenerAttached = "1";
      }
    }
  }

  window.showManualSalesModal = function showManualSalesModal(){
    const existing = document.getElementById("manualSalesModalBackdrop");
    if(existing) existing.remove();

    const allOrders = loadP2PBinanceOrders();
    const manualOrders = allOrders.filter(o => {
      const status = String(o.orderStatus || "").toUpperCase();
      const type = String(o.tradeType || "").toUpperCase();
      const fiat = String(o.fiat || "").toUpperCase();
      const isManual = o._manual || String(o.orderNumber || '').startsWith('manual_');
      return status === "COMPLETED" && type === "SELL" && fiat === "CLP" && isManual;
    });

    const backdrop = document.createElement("div");
    backdrop.id = "manualSalesModalBackdrop";
    backdrop.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);";

    backdrop.innerHTML = `
      <div style="background:linear-gradient(145deg,rgba(15,23,42,.97),rgba(15,23,42,.99));border:1px solid rgba(148,163,184,.1);border-radius:16px;padding:24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="color:#f8fafc;margin:0;font-size:16px;">📋 Ventas Manuales</h3>
          <button class="btn secondary" type="button" onclick="this.closest('#manualSalesModalBackdrop').remove()" style="padding:4px 10px;font-size:13px;">✕</button>
        </div>
        ${manualOrders.length === 0
          ? `<div class="p2p-dashboard-empty" style="padding:20px;text-align:center;color:#8aa0ba;">Sin ventas manuales registradas.</div>`
          : manualOrders.map((o, i) => {
              const usdt = Number(o.amount || 0);
              const clp = Number(o.totalPrice || 0);
              const price = Number(o.unitPrice || 0);
              const comm = Number(o.commission || 0);
              const date = o.createdAt ? new Date(o.createdAt).toLocaleString("es-CL", {timeZone:"America/Santiago",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.08);">
                  <div style="flex:1;min-width:0;">
                    <div style="color:#f8fafc;font-size:13px;font-weight:600;">${p2pCapMoney(usdt, 2)} USDT · ${p2pCapMoney(price, 2)} CLP</div>
                    <div style="color:#8aa0ba;font-size:11px;margin-top:2px;">${p2pCapMoney(clp, 0)} CLP · Comisión ${p2pCapMoney(comm, 4)} USDT</div>
                    <div style="color:#5a738e;font-size:10px;margin-top:2px;">${date}</div>
                  </div>
                  <button class="btn small danger" type="button" onclick="window.deleteManualSale('${o.orderNumber}')" title="Borrar venta manual" style="padding:2px 6px;font-size:12px;line-height:1;flex-shrink:0;">🗑️</button>
                </div>
              `;
            }).join("")
        }
      </div>
    `;

    backdrop.addEventListener("click", function(e){
      if(e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
  };

  window.syncBinanceP2P = async function syncBinanceP2P(){
    const btn = document.getElementById("syncBinanceP2PBtn");
    if(!btn) return;

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sincronizando...";

    try{
      var p2pLbl = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '?label=' + encodeURIComponent(botActiveLabel) : '';
      const res = await fetch("/api/binance/p2p-history" + p2pLbl, {
        method:"GET",
        credentials:"include"
      });

      const data = await res.json();

      if(!res.ok || !data.ok){
        throw new Error(data.error || "No se pudo sincronizar Binance P2P.");
      }

      saveP2PBinanceOrders(data.orders || []);
      renderP2PDashboardFromBinance();


    }catch(error){
      onzeAlert(error.message || "Error sincronizando Binance P2P.");
    }finally{
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  function initBinanceP2PSync(){
    const btn = document.getElementById("syncBinanceP2PBtn");
    if(btn && !btn.dataset.ready){
      btn.dataset.ready = "1";
      btn.addEventListener("click", syncBinanceP2P);
    }

    renderP2PDashboardFromBinance();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      setTimeout(initBinanceP2PSync, 500);
      setTimeout(initBinanceP2PSync, 1500);
    });
  }else{
    setTimeout(initBinanceP2PSync, 500);
    setTimeout(initBinanceP2PSync, 1500);
  }
})();
