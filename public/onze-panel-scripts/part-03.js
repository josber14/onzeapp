
    const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Teo-_5ka3LKx7FXL3x3yV3uf4KhoI61ewnVJyJ90XRnksoObf4CDn-lJvrFKiQ/pub?gid=119557813&single=true&output=csv";
    const urlParams = new URLSearchParams(window.location.search);
    const CSV_URL = urlParams.get("sheetUrl") || DEFAULT_CSV_URL;

    const CURRENT_USER_CONTEXT = {
      role: (urlParams.get("role") || "").trim().toLowerCase(),
      tenantId: urlParams.get("tenantId") || "",
      operatorMode: (urlParams.get("operatorMode") || "").trim().toLowerCase(),
      dataSourceMode: (urlParams.get("dataSourceMode") || "").trim().toLowerCase(),
      percentageRate: Number(urlParams.get("percentageRate") || 0),
      partnerSharePercent: Number(urlParams.get("partnerSharePercent") || 0)
    };

    window.currentUserContext = CURRENT_USER_CONTEXT;

    // Reemplazo de confirm()/onzeAlert() nativos con el estilo de la web -- ver
    // comentario del markup de #onzeConfirmModal más arriba. Un solo modal
    // compartido alcanza (igual que el confirm/alert nativo, es bloqueante
    // para el usuario -- nunca hay dos abiertos al mismo tiempo en la
    // práctica).
    let onzeConfirmResolve = null;
    const onzeConfirmModalEl = document.getElementById('onzeConfirmModal');
    const onzeConfirmTitleEl = document.getElementById('onzeConfirmTitle');
    const onzeConfirmMessageEl = document.getElementById('onzeConfirmMessage');
    const onzeConfirmOkBtn = document.getElementById('onzeConfirmOkBtn');
    const onzeConfirmCancelBtn = document.getElementById('onzeConfirmCancelBtn');

    function onzeCloseConfirmModal(){
      if(!onzeConfirmModalEl) return;
      onzeConfirmModalEl.classList.remove('open');
      onzeConfirmModalEl.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('noscroll');
    }

    function onzeShowConfirmModal(message, opts){
      if(!onzeConfirmModalEl) return;
      onzeConfirmTitleEl.textContent = opts.title || (opts.isAlert ? 'Aviso' : 'Confirmar');
      onzeConfirmMessageEl.textContent = message;
      onzeConfirmOkBtn.textContent = opts.confirmText || 'Aceptar';
      onzeConfirmOkBtn.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
      onzeConfirmCancelBtn.style.display = opts.isAlert ? 'none' : 'inline-flex';
      onzeConfirmCancelBtn.textContent = opts.cancelText || 'Cancelar';
      onzeConfirmModalEl.classList.add('open');
      onzeConfirmModalEl.setAttribute('aria-hidden', 'false');
      document.body.classList.add('noscroll');
    }

    if(onzeConfirmOkBtn) onzeConfirmOkBtn.addEventListener('click', function(){
      onzeCloseConfirmModal();
      const resolve = onzeConfirmResolve;
      onzeConfirmResolve = null;
      if(resolve) resolve(true);
    });
    if(onzeConfirmCancelBtn) onzeConfirmCancelBtn.addEventListener('click', function(){
      onzeCloseConfirmModal();
      const resolve = onzeConfirmResolve;
      onzeConfirmResolve = null;
      if(resolve) resolve(false);
    });

    // Reemplaza window.confirm() -- devuelve una Promise<boolean>, hay que
    // usarla con "await" (igual que confirm() bloqueaba, esto pausa el
    // flujo async hasta que el usuario responde).
    window.onzeConfirm = function(message, opts){
      return new Promise(function(resolve){
        onzeShowConfirmModal(message, opts || {});
        onzeConfirmResolve = resolve;
      });
    };

    // Reemplaza window.alert() -- de un solo botón ("Aceptar"), sin
    // Cancelar. También devuelve una Promise por si se quiere esperar a que
    // el usuario la cierre, pero no es obligatorio usarla con "await".
    window.onzeAlert = function(message, opts){
      return new Promise(function(resolve){
        onzeShowConfirmModal(message, Object.assign({}, opts, { isAlert: true }));
        onzeConfirmResolve = function(){ resolve(); };
      });
    };

    function isGlobalAdmin(){
      return CURRENT_USER_CONTEXT.role === "super_admin_global";
    }

    function isTenantAdmin(){
      return CURRENT_USER_CONTEXT.role === "super_admin_cliente";
    }

    // "Historial de tasa" -- pedido explícito del usuario (ago 2026): solo
    // super_admin_global lo ve, nadie más (ni tenant admin ni operador). El
    // backend (/api/rate-history) también exige ese rol -- esto es solo para
    // no mostrar el botón, la autorización real está en la API.
    (function initRateHistoryButtonVisibility(){
      const btn = document.getElementById("rateHistoryBtn");
      if(btn && isGlobalAdmin()) btn.style.display = "inline-flex";
    })();

    function getActiveCalculatorMode(){
      if(isGlobalAdmin() || isTenantAdmin()){
        return String(window.adminCalculatorMode || "onze").trim().toLowerCase();
      }
      return String(CURRENT_USER_CONTEXT.operatorMode || "").trim().toLowerCase();
    }

    function isOnzeCalculator(){
      return getActiveCalculatorMode() === "onze";
    }

    function isFixedPercentOperator(){
      return getActiveCalculatorMode() === "porcentaje";
    }

    function isPartnerOperator(){
      return getActiveCalculatorMode() === "socio";
    }

    function isFiftyFiftyPartner(){
      return getActiveCalculatorMode() === "socio";
    }

    function isFreeOperator(){
      return getActiveCalculatorMode() === "libre";
    }

    function getFixedPercentValue(){
      const value = Number(CURRENT_USER_CONTEXT.percentageRate || 0);
      return Number.isFinite(value) ? value : 0;
    }

    function calcFixedPercentProfitFromOrigin(originAmount){
      const amount = Number(originAmount || 0);
      const pct = getFixedPercentValue();
      if(!Number.isFinite(amount) || !Number.isFinite(pct)) return 0;
      return amount * (pct / 100);
    }

    function parsePercentLike(value){
      if(value === null || value === undefined || value === "") return 0;
      if(typeof value === "number") return Number.isFinite(value) ? value : 0;
      const n = parseHumanNumber(String(value));
      return Number.isFinite(n) ? n : 0;
    }

    function calcOriginNetAfterCommission(originAmount, commissionPercent){
      const amount = Number(originAmount || 0);
      const pct = parsePercentLike(commissionPercent);
      if(!Number.isFinite(amount) || !Number.isFinite(pct)) return 0;
      return amount - (amount * (pct / 100));
    }

    function round2(value){
      if(!Number.isFinite(value)) return 0;
      return Math.round(value * 100) / 100;
    }

    function calcPartner5050Metrics({
      originAmount,
      receiveAmount,
      originBuyRate,
      destSellRate,
      commissionPercent = 0
    }){
      const amountOrigin = Number(originAmount || 0);
      const amountDest = Number(receiveAmount || 0);
      const buyOrigin = Number(originBuyRate || 0);
      const sellDest = Number(destSellRate || 0);
      const commissionPct = parsePercentLike(commissionPercent);

      if(
        !Number.isFinite(amountOrigin) ||
        !Number.isFinite(amountDest) ||
        !Number.isFinite(buyOrigin) || buyOrigin <= 0 ||
        !Number.isFinite(sellDest) || sellDest <= 0
      ){
        return null;
      }

      const originNet = calcOriginNetAfterCommission(amountOrigin, commissionPct);
      const usdtOrigin = round2(originNet / buyOrigin);
      const usdtDest = round2(amountDest / sellDest);
      const totalProfit = round2(usdtOrigin - usdtDest);
      const partnerProfit = round2(totalProfit / 2);
      const onzeProfit = round2(totalProfit / 2);
      const totalOnze = round2(usdtDest + onzeProfit);

      return {
        commissionPercent: commissionPct,
        originNet,
        usdtOrigin,
        usdtDest,
        totalProfit,
        partnerProfit,
        onzeProfit,
        totalOnze
      };
    }

    function parsePercentLike(value){
      if(value === null || value === undefined || value === "") return 0;
      if(typeof value === "number") return Number.isFinite(value) ? value : 0;
      const n = parseHumanNumber(String(value));
      return Number.isFinite(n) ? n : 0;
    }

    function canSeeCostRate(){
      return isGlobalAdmin() || isTenantAdmin();
    }

    function canSeeRetailRate(){
      return isGlobalAdmin() || isTenantAdmin() || isFixedPercentOperator() || isPartnerOperator();
    }

    function canSeeProviderRate(){
      if(isGlobalAdmin() || isTenantAdmin()) return true;
      if(isFreeOperator()) return true;
      return false;
    }

    function getVisibleBaseRate(row){
      if(!row) return null;

      if(isGlobalAdmin() || isTenantAdmin()){
        return {
          type: "retail",
          value: row.retailRate ?? null
        };
      }

      if(isFixedPercentOperator() || isPartnerOperator()){
        return {
          type: "retail",
          value: row.retailRate ?? null
        };
      }

      if(isFreeOperator()){
        return {
          type: "provider",
          value: row.providerRate ?? row.value ?? null
        };
      }

      return {
        type: "retail",
        value: row.retailRate ?? null
      };
    }

    function getOnzeImprovedRetailRate(row){
      const retailRate = Number(row?.retailRate ?? null);
      const improvePct = Number(window.onzeImproveRatePercent || 0);

      if(!Number.isFinite(retailRate)) return null;
      if(!Number.isFinite(improvePct) || improvePct <= 0) return retailRate;

      return retailRate + (retailRate * (improvePct / 100));
    }

    window.canSeeCostRate = canSeeCostRate;
    window.canSeeRetailRate = canSeeRetailRate;
    window.canSeeProviderRate = canSeeProviderRate;
    window.getVisibleBaseRate = getVisibleBaseRate;
    const STORAGE_KEY = "aki_transfer_operations_v2";
    const CLIENTS_KEY = "aki_transfer_clients_v1";
    const PROFILE_KEY = "onze_operator_profile_v1";
    const NOTES_KEY = "onze_operator_notes_v1";
    const CAPITAL_KEY = "onze_initial_capital_v1";
    const BALANCE_MOVEMENTS_KEY = "onze_balance_movements_v1";
    const LIQUIDITY_ALERTS_KEY = "onze_liquidity_alerts_v1";
    const INTERNAL_FUNDINGS_KEY = "onze_internal_fundings_v1";
    const EARNINGS_KEY = "onze_earnings_movements_v1";
    const COLLABORATOR_PAYMENTS_KEY = "onze_collaborator_payments_v1";
    const WHATSAPP_NUMBER = "56951333777";
    const PANEL_QUERY = new URLSearchParams(window.location.search);
    // Bug real confirmado (ago 2026, tenant de Hector): las claves de
    // localStorage del módulo P2P (capacity, ventas Binance/Bybit/OKX,
    // capital inicial) eran GLOBALES al origen onze-pay.com, sin distinguir
    // tenant -- si el mismo navegador llegó a tener abierta otra cuenta
    // (ej. un tab de otra sesión), sus ventas se mezclaron con las de este
    // tenant y calculateP2PCapacityStats() llenó y cerró de golpe 20
    // capacities activos de Hector con ventas que no eran suyas. Cada clave
    // ahora se guarda separada por tenant (window.__p2pTenantSuffix), leído
    // acá arriba de todo porque este es el primer <script> del panel --
    // varios bloques <script> más abajo (cada uno con su propio scope IIFE)
    // lo necesitan y no pueden ver PANEL_QUERY directamente.
    window.__p2pTenantSuffix = "_t" + (PANEL_QUERY.get("tenantId") || "0");
    // Purga de emergencia, UNA sola vez por navegador (sep 2026): se
    // encontró la variante residual del bug de arriba -- el sufijo por
    // tenant se fija UNA vez al cargar esta pestaña, así que si la cookie de
    // sesión de este navegador cambia mientras esta pestaña sigue viva de
    // fondo (ej. alguien inicia sesión con OTRA cuenta en otra pestaña del
    // MISMO navegador -- la cookie es compartida por todo el navegador, no
    // por pestaña), esta pestaña vieja podía guardar ventas de la cuenta
    // NUEVA bajo la etiqueta de la cuenta VIEJA (confirmado en vivo: ventas
    // reales de Hector aparecieron como "sin asignar" en otra cuenta). El
    // arreglo de fondo (ver isP2PSalesResponseTenantValid en part-12.js)
    // evita que esto vuelva a pasar -- esta purga limpia lo que YA haya
    // quedado contaminado antes de ese arreglo, en CUALQUIER sufijo (no solo
    // el de esta cuenta, porque no hay forma de saber cuál quedó mal desde
    // acá). No se pierde nada real: todo se re-sincroniza solo y gratis
    // desde el servidor la próxima vez que se necesite.
    try {
      if (!localStorage.getItem("__p2pSalesCachePurgeSep2026")) {
        const purgePrefixes = ["onze_p2p_binance_orders", "onze_p2p_bybit_orders", "onze_p2p_okx_orders", "onze_binance_sales"];
        const purgeKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && purgePrefixes.some(p => k.indexOf(p) === 0)) purgeKeys.push(k);
        }
        purgeKeys.forEach(k => localStorage.removeItem(k));
        localStorage.setItem("__p2pSalesCachePurgeSep2026", "1");
      }
    } catch (e) {}
    const SESSION_ROLE = String(PANEL_QUERY.get("role") || "").trim();
    const IS_ADMIN_ROLE =
      SESSION_ROLE === "super_admin_global" ||
      SESSION_ROLE === "super_admin_cliente";
    // Pedido explícito del usuario (ago 2026), pensando el sistema como
    // vendible a otros clientes: el selector ONZE/ZINPLE (2 cuentas
    // Binance) y la pestaña Skipo del panel P2P son específicos del
    // negocio de ONZE -- vienen del tenant (ver app/dashboard/page.tsx),
    // no del rol. Un tenant nuevo (ej. un cliente al que se le vende esta
    // herramienta) no los ve por defecto.
    window.P2P_MULTI_ACCOUNT = PANEL_QUERY.get("p2pMultiAccount") === "1";
    window.SKIPO_ENABLED = PANEL_QUERY.get("skipoEnabled") === "1";
    // Inicio, Noticias, Dashboard/Calculadora ONZE en modo completo, AKI
    // TRANSFERS, Clientes USDT -- confirmado con el usuario (ago 2026):
    // un tenant nuevo (vendible) solo ve Perfil, Calculadora ONZE (fijo en
    // modo "libre"), Calculadora P2P, Dashboard P2P, Crea tu tasa del día,
    // P2P Bot, Historial y Ajustes.
    window.HAS_ONZE_CORE_BUSINESS = PANEL_QUERY.get("hasOnzeCoreBusiness") === "1";

    // Pedido explícito del usuario (ago 2026): "que nada se pueda mezclar
    // con lo mío de ninguna manera" -- ahora que dos tenants distintos
    // (ONZE y el de un cliente nuevo) pueden entrar al mismo dominio, hay
    // que blindar el caché local. Varias partes del panel (órdenes
    // sincronizadas de Binance/Bybit/OKX, capacity, capital inicial, etc.)
    // se guardan en localStorage del navegador -- eso vive POR NAVEGADOR,
    // no por tenant, así que si alguna vez el MISMO navegador se usa para
    // entrar con dos tenants distintos (ej. alguien prueba con la sesión
    // de otra persona en su compu), quedaría caché de un tenant mezclado
    // con el otro. Esto detecta si el tenant activo cambió respecto a la
    // última vez que se usó ESTE navegador y, si cambió, borra todo el
    // caché local relacionado (prefijos onze_ y aki_transfer_) ANTES de
    // que cualquier otra función del panel llegue a leerlo -- el servidor
    // (Neon) sigue siendo la fuente de verdad real, así que no se pierde
    // nada, solo se refresca desde cero.
    (function enforceTenantLocalStorageFence(){
      try{
        const currentTenantId = String(PANEL_QUERY.get("tenantId") || "").trim();
        if(!currentTenantId) return;
        const MARKER_KEY = "onze_last_tenant_id";
        const lastTenantId = localStorage.getItem(MARKER_KEY);
        if(lastTenantId !== null && lastTenantId !== currentTenantId){
          const keysToRemove = [];
          for(let i = 0; i < localStorage.length; i++){
            const key = localStorage.key(i);
            if(key && key !== MARKER_KEY && (key.indexOf("onze_") === 0 || key.indexOf("aki_transfer_") === 0)){
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(function(k){ localStorage.removeItem(k); });
          console.log("[ONZE] Cambió el tenant activo en este navegador -- caché local limpiado (" + keysToRemove.length + " claves) para que no se mezcle nada.");
        }
        localStorage.setItem(MARKER_KEY, currentTenantId);
      }catch(e){
        console.warn("No se pudo verificar el tenant del caché local:", e);
      }
    })();

    const sel = document.getElementById("country");
    const destSel = document.getElementById("destination");
    const viewAllBtn = document.getElementById("viewAllBtn");
    const title = document.getElementById("title");
    const ratesBox = document.getElementById("rates");
    const errorBox = document.getElementById("errorBox");
    const refreshBtn = document.getElementById("refreshBtn");
    const copyCountryBtn = document.getElementById("copyCountryBtn");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const toastEl = document.getElementById("toast");
    const sidebar = document.getElementById("sidebar");
    const menuToggleBtn = document.getElementById("menuToggleBtn");
    // Se ata este listener acá mismo, apenas se agarran las referencias del
    // DOM, en vez de más abajo junto con el resto de los bindings (línea
    // ~9643 antes de este cambio). Reporte real (sep 2026): en la cuenta de
    // Hector, tocar "Menú" al toque de abrir la sesión desde el celular no
    // hacía NADA la primera vez, siempre, sin importar cuántas veces se
    // repitiera la prueba -- hasta el enésimo toque. Hipótesis: este panel
    // es un solo <script> de ~30.000 líneas que se ejecuta de corrido; el
    // botón "Menú" ya está visible en el HTML/CSS desde el primer instante
    // (no depende de JS para dibujarse), pero su addEventListener recién se
    // ejecutaba miles de líneas más abajo -- en un celular más lento o con
    // peor conexión, ese hueco entre "se ve el botón" y "el botón ya
    // reacciona" puede durar un rato real, y cualquier toque en el medio se
    // pierde sin ningún error visible. Atar el listener acá, antes de
    // cualquier otra inicialización pesada, cierra ese hueco al mínimo.
    if(menuToggleBtn && sidebar){
      menuToggleBtn.addEventListener("click", ()=>{
        sidebar.classList.toggle("open");
      });
    }

    const profitBtn = document.getElementById("profitBtn");
    const profitMenu = document.getElementById("profitMenu");
    const pctBadge = document.getElementById("pctBadge");
    const adminCalcModeWrap = document.getElementById("adminCalcModeWrap");
    const adminCalcMode = document.getElementById("adminCalcMode");
    const profitControlWrap = document.getElementById("profitControlWrap");
    const onzeImproveRateWrap = document.getElementById("onzeImproveRateWrap");
    const onzeImproveRatePct = document.getElementById("onzeImproveRatePct");
    const applyOnzeImproveRateBtn = document.getElementById("applyOnzeImproveRateBtn");
    const resetOnzeImproveRateBtn = document.getElementById("resetOnzeImproveRateBtn");

    let adminCalculatorMode = "onze";
    let onzeImproveRatePercent = 0;
    let restoredCountry = "";
    let restoredDestination = "";

    function syncAdminCalculatorControls(){
      const isAdminCalc = isGlobalAdmin() || isTenantAdmin();
      const activeMode = isAdminCalc ? getActiveCalculatorMode() : "";

      if(profitControlWrap){
        if(isAdminCalc){
          profitControlWrap.style.display = activeMode === "libre" ? "flex" : "none";
        }else{
          profitControlWrap.style.display = "flex";
        }
      }

      if(onzeImproveRateWrap){
        onzeImproveRateWrap.style.display = (isAdminCalc && activeMode === "onze") ? "flex" : "none";
      }
    }

    // Pedido explícito del usuario (ago 2026), confirmado con ejemplo
    // concreto: un tenant sin negocio ONZE (ej. un cliente al que se le
    // vende el bot P2P) solo puede usar la Calculadora ONZE en modo
    // "libre" -- nunca ve el selector de modo ni puede cambiar a
    // porcentaje/socio/manual. Se gatea por el FLAG del tenant
    // (window.HAS_ONZE_CORE_BUSINESS), no por el rol, para que esto quede
    // correcto sin importar qué rol tenga el usuario que entra.
    if((isGlobalAdmin() || isTenantAdmin()) && window.HAS_ONZE_CORE_BUSINESS && adminCalcModeWrap && adminCalcMode){
      adminCalcModeWrap.style.display = "flex";

      try{
        const savedMode = localStorage.getItem("onze_admin_calculator_mode");
        if(savedMode) adminCalculatorMode = String(savedMode).trim().toLowerCase() || "onze";
      }catch{}

      try{
        const savedImprove = localStorage.getItem("onze_admin_improve_rate_percent");
        const parsedImprove = Number(savedImprove || 0);
        onzeImproveRatePercent = Number.isFinite(parsedImprove) ? parsedImprove : 0;
      }catch{}

      try{
        restoredCountry = String(localStorage.getItem("onze_selected_country") || "").trim();
        restoredDestination = String(localStorage.getItem("onze_selected_destination") || "").trim();
      }catch{}

      if(onzeImproveRatePct){
        onzeImproveRatePct.value = onzeImproveRatePercent ? String(onzeImproveRatePercent) : "";
      }

      adminCalcMode.value = adminCalculatorMode;
      window.adminCalculatorMode = adminCalculatorMode;
      window.onzeImproveRatePercent = onzeImproveRatePercent;
      syncAdminCalculatorControls();

      adminCalcMode.addEventListener("change", () => {
        adminCalculatorMode = String(adminCalcMode.value || "onze").trim().toLowerCase();
        window.adminCalculatorMode = adminCalculatorMode;

        try{
          localStorage.setItem("onze_admin_calculator_mode", adminCalculatorMode);
          localStorage.removeItem("onze_selected_country");
          localStorage.removeItem("onze_selected_destination");
        }catch{}

        restoredCountry = "";
        restoredDestination = "";
        if(sel) sel.value = "";
        if(destSel){
          destSel.value = "";
          destSel.innerHTML = '<option value="" selected>Selecciona un destino…</option>';
          destSel.disabled = true;
        }

        syncAdminCalculatorControls();

        if(typeof renderAll === "function"){
          renderAll();
        }else{
          location.reload();
        }
      });

      if(applyOnzeImproveRateBtn){
        applyOnzeImproveRateBtn.addEventListener("click", () => {
          const val = Number(String(onzeImproveRatePct?.value || "").replace(",", "."));
          onzeImproveRatePercent = Number.isFinite(val) && val >= 0 ? val : 0;
          window.onzeImproveRatePercent = onzeImproveRatePercent;

          try{
            localStorage.setItem("onze_admin_improve_rate_percent", String(onzeImproveRatePercent));
          }catch{}

          if(typeof renderAll === "function"){
            renderAll();
          }else{
            location.reload();
          }
        });
      }

      if(resetOnzeImproveRateBtn){
        resetOnzeImproveRateBtn.addEventListener("click", () => {
          onzeImproveRatePercent = 0;
          window.onzeImproveRatePercent = 0;
          if(onzeImproveRatePct) onzeImproveRatePct.value = "";

          try{
            localStorage.setItem("onze_admin_improve_rate_percent", "0");
          }catch{}

          if(typeof renderAll === "function"){
            renderAll();
          }else{
            location.reload();
          }
        });
      }
    } else if((isGlobalAdmin() || isTenantAdmin()) && !window.HAS_ONZE_CORE_BUSINESS){
      // Tenant sin negocio ONZE (ej. Hector) -- Calculadora ONZE fija en
      // modo "libre", sin selector de modo visible.
      adminCalculatorMode = "libre";
      window.adminCalculatorMode = "libre";
      if(adminCalcModeWrap) adminCalcModeWrap.style.display = "none";
      syncAdminCalculatorControls();
    }

    if(isFixedPercentOperator() || isPartnerOperator() || isOnzeCalculator()){
      const profitInfoRow = profitBtn ? profitBtn.closest(".muted") : null;
      const popoverWrap = profitBtn ? profitBtn.closest(".popover") : null;

      if(pctBadge){
        pctBadge.textContent = "";
        pctBadge.classList.remove("show");
      }

      if(profitInfoRow && !((isGlobalAdmin() || isTenantAdmin()) && adminCalcModeWrap)){
        profitInfoRow.style.display = "none";
      }

      if(popoverWrap){
        popoverWrap.style.display = "none";
      }

      if(profitBtn){
        profitBtn.disabled = true;
        profitBtn.style.display = "none";
      }

      if(profitMenu){
        profitMenu.classList.remove("open");
        profitMenu.style.display = "none";
      }
    }

    const toggleCalc = document.getElementById("toggleCalc");
    const calcState = document.getElementById("calcState");
    const customPct = document.getElementById("customPct");
    const applyCustom = document.getElementById("applyCustom");

    const historyBody = document.getElementById("historyBody");
    const historyEmpty = document.getElementById("historyEmpty");
    const addExpenseBtn = document.getElementById("addExpenseBtn");
    const expenseDate = document.getElementById("expenseDate");
    const expenseCategory = document.getElementById("expenseCategory");
    const expenseCountry = document.getElementById("expenseCountry");
    const expenseCurrency = document.getElementById("expenseCurrency");
    const expenseAmount = document.getElementById("expenseAmount");
    const expenseNote = document.getElementById("expenseNote");
    const expensesBody = document.getElementById("expensesBody");
    const expensesEmpty = document.getElementById("expensesEmpty");
    const dashProfitToday = document.getElementById("dashProfitToday");
    const dashProfitTodayCur = document.getElementById("dashProfitTodayCur");
    const dashProfitMonth = document.getElementById("dashProfitMonth");
    const dashProfitMonthCur = document.getElementById("dashProfitMonthCur");
    const dashOpsToday = document.getElementById("dashOpsToday");
    const dashOpsMonth = document.getElementById("dashOpsMonth");
    const dashUsdtCollected = document.getElementById("dashUsdtCollected");
    const dashUsdtPending = document.getElementById("dashUsdtPending");
    const dashUsdtCapital = document.getElementById("dashUsdtCapital");
    const dashMonthExpenses = document.getElementById("dashMonthExpenses");
    const dashNetBalance = document.getElementById("dashNetBalance");
    const dashReceivablesCount = document.getElementById("dashReceivablesCount");
    const dashReceivablesUsdt = document.getElementById("dashReceivablesUsdt");
    const dashCountriesTotal = document.getElementById("dashCountriesTotal");
    const dashCountriesTotalUsdt = document.getElementById("dashCountriesTotalUsdt");
    const openCapitalSetupBtn = document.getElementById("openCapitalSetupBtn");
    const openProviderControlBtn = document.getElementById("openProviderControlBtn");
    const backToDashboardFromProvidersBtn = document.getElementById("backToDashboardFromProvidersBtn");
    const addProviderBtn = document.getElementById("addProviderBtn");
    const providersGrid = document.getElementById("providersGrid");
    const providersEmpty = document.getElementById("providersEmpty");
    const providersActiveCount = document.getElementById("providersActiveCount");
    const providersOpenClosings = document.getElementById("providersOpenClosings");
    const providersLastClosing = document.getElementById("providersLastClosing");
    const viewProviderPendingBtn = document.getElementById("viewProviderPendingBtn");
    const providerPendingPanel = document.getElementById("providerPendingPanel");
    const providerPendingList = document.getElementById("providerPendingList");
    const backToProvidersFromPendingBtn = document.getElementById("backToProvidersFromPendingBtn");
    const providerPendingTotalCount = document.getElementById("providerPendingTotalCount");
    const providerPendingCountriesCount = document.getElementById("providerPendingCountriesCount");
    const providerPendingReceivedCount = document.getElementById("providerPendingReceivedCount");
    const providerPendingPaidCount = document.getElementById("providerPendingPaidCount");
    const providerPendingFullList = document.getElementById("providerPendingFullList");
    const providerDetailPanel = document.getElementById("providerDetailPanel");
    const providerDetailTitle = document.getElementById("providerDetailTitle");
    const providerDetailSubtitle = document.getElementById("providerDetailSubtitle");
    const shareProviderSummaryBtn = document.getElementById("shareProviderSummaryBtn");
    const shareProviderDetailBtn = document.getElementById("shareProviderDetailBtn");
    const closeProviderDetailBtn = document.getElementById("closeProviderDetailBtn");
    const providerReceivedTotal = document.getElementById("providerReceivedTotal");
    const providerReceivedCount = document.getElementById("providerReceivedCount");
    const providerPaidTotal = document.getElementById("providerPaidTotal");
    const providerPaidCount = document.getElementById("providerPaidCount");
    const providerFinalResult = document.getElementById("providerFinalResult");
    const providerDetailList = document.getElementById("providerDetailList");
    let currentProviderDetailId = null;
    let currentProviderSummaryText = "";
    let currentProviderDetailText = "";
    let providerDetailOriginalParent = null;
    let providerDetailOriginalNext = null;

    function shareProviderTextByWhatsapp(textToShare){
      const cleanText = String(textToShare || "").trim();

      if(!cleanText){
        onzeAlert("No hay información disponible para compartir.");
        return;
      }

      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(cleanText)}`;

      try{
        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      }catch(e){
        window.location.href = whatsappUrl;
      }
    }

    function ensureProviderControlScreen(){
      let screen = document.getElementById("providerControlScreen");

      if(screen) return screen;

      screen = document.createElement("div");
      screen.id = "providerControlScreen";
      screen.style.cssText = `
        position:fixed;
        inset:0;
        z-index:9999;
        display:none;
        overflow:auto;
        padding:22px;
        background:rgba(2,6,23,.88);
        backdrop-filter:blur(14px);
    `;

      const shell = document.createElement("div");
      shell.id = "providerControlShell";
      shell.style.cssText = `
        width:min(1120px,100%);
        margin:0 auto;
        border-radius:28px;
        border:1px solid rgba(148,163,184,.22);
        background:linear-gradient(135deg,rgba(15,23,42,.98),rgba(2,6,23,.98));
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        padding:18px;
      `;

      screen.appendChild(shell);
      document.body.appendChild(screen);

      screen.addEventListener("click", function(e){
        if(e.target === screen){
          closeProviderControlScreen();
        }
      });

      return screen;
    }

    function openProviderControlScreen(){
      if(!providerDetailPanel) return;

      const screen = ensureProviderControlScreen();
      const shell = document.getElementById("providerControlShell");

      if(!providerDetailOriginalParent){
        providerDetailOriginalParent = providerDetailPanel.parentNode;
        providerDetailOriginalNext = providerDetailPanel.nextSibling;
      }

      if(shell && providerDetailPanel.parentNode !== shell){
        shell.appendChild(providerDetailPanel);
      }

      providerDetailPanel.style.display = "block";
      providerDetailPanel.style.marginTop = "0";
      screen.style.display = "block";
      document.body.style.overflow = "hidden";
    }

    function closeProviderControlScreen(){
      const screen = document.getElementById("providerControlScreen");

      if(providerDetailPanel){
        providerDetailPanel.style.display = "none";

        if(providerDetailOriginalParent && providerDetailPanel.parentNode !== providerDetailOriginalParent){
          providerDetailOriginalParent.insertBefore(providerDetailPanel, providerDetailOriginalNext);
        }
      }

      if(screen) screen.style.display = "none";
      document.body.style.overflow = "";
    }
    if(closeProviderDetailBtn){
      closeProviderDetailBtn.addEventListener("click", function(){
        closeProviderControlScreen();
      });
    }

    if(shareProviderSummaryBtn){
      shareProviderSummaryBtn.onclick = function(){
        shareProviderTextByWhatsapp(currentProviderSummaryText);
      };
    }

    if(shareProviderDetailBtn){
      shareProviderDetailBtn.onclick = function(){
        shareProviderTextByWhatsapp(currentProviderDetailText);
      };
    }

    const providerModal = document.getElementById("providerModal");
    const providerModalTitle = document.getElementById("providerModalTitle");
    const closeProviderModalBtn = document.getElementById("closeProviderModalBtn");
    const cancelProviderModalBtn = document.getElementById("cancelProviderModalBtn");
    const saveProviderBtn = document.getElementById("saveProviderBtn");
    const providerNameInput = document.getElementById("providerNameInput");
    const providerCountryInput = document.getElementById("providerCountryInput");
    const providerCurrencyInput = document.getElementById("providerCurrencyInput");
    const providerNoteInput = document.getElementById("providerNoteInput");
    let editingProviderId = null;
    const capitalCountry = document.getElementById("capitalCountry");
    const capitalCurrency = document.getElementById("capitalCurrency");
    const capitalAmount = document.getElementById("capitalAmount");
    const saveCapitalBtn = document.getElementById("saveCapitalBtn");
    const capitalInitialGrid = document.getElementById("capitalInitialGrid");
    const capitalInitialEmpty = document.getElementById("capitalInitialEmpty");

    const capitalActionModal = document.getElementById("capitalActionModal");
    const closeCapitalActionModalBtn = document.getElementById("closeCapitalActionModalBtn");
    const cancelCapitalActionModalBtn = document.getElementById("cancelCapitalActionModalBtn");
    const capitalResetMovementsBtn = document.getElementById("capitalResetMovementsBtn");
    const capitalDeleteCardBtn = document.getElementById("capitalDeleteCardBtn");
    const capitalActionCountry = document.getElementById("capitalActionCountry");
    const capitalActionCurrency = document.getElementById("capitalActionCurrency");

    const countryDetailModal = document.getElementById("countryDetailModal");
    const closeCountryDetailModalBtn = document.getElementById("closeCountryDetailModalBtn");
    const countryDetailSelect = document.getElementById("countryDetailSelect");
    const countryDetailCurrency = document.getElementById("countryDetailCurrency");
    const countryDetailBalance = document.getElementById("countryDetailBalance");
    const countryDetailEntries = document.getElementById("countryDetailEntries");
    const countryDetailExits = document.getElementById("countryDetailExits");
    const countryDetailCount = document.getElementById("countryDetailCount");
    const countryDetailTitle = document.getElementById("countryDetailTitle");
    const countryDetailBody = document.getElementById("countryDetailBody");
    const countryDetailEmpty = document.getElementById("countryDetailEmpty");

    const registerModal = document.getElementById("registerModal");
    const closeModalBtn = document.getElementById("closeModalBtn");
    const cancelModalBtn = document.getElementById("cancelModalBtn");
    const saveOperationBtn = document.getElementById("saveOperationBtn");

    const summaryRoute = document.getElementById("summaryRoute");
    const summaryProviderRateWrap = document.getElementById("summaryProviderRateWrap");
    const summaryProviderRate = document.getElementById("summaryProviderRate");
    const summaryClientRate = document.getElementById("summaryClientRate");
    const summaryMargin = document.getElementById("summaryMargin");
    const summarySend = document.getElementById("summarySend");
    const summaryReceive = document.getElementById("summaryReceive");
    const summaryProviderPayWrap = document.getElementById("summaryProviderPayWrap");
    const summaryProviderPay = document.getElementById("summaryProviderPay");

    const clientName = document.getElementById("clientName");
    const clientSuggestionsList = document.getElementById("clientSuggestionsList");
    const operationNumber = document.getElementById("operationNumber");
    const operationDate = document.getElementById("operationDate");
    const operationNote = document.getElementById("operationNote");
    const profitCurrencyGroup = document.getElementById("profitCurrencyGroup");
    const payerSideGroup = document.getElementById("payerSideGroup");
    const payerSideChoices = document.getElementById("payerSideChoices");
    const profitConvertQuestionGroup = document.getElementById("profitConvertQuestionGroup");
    const profitConvertQuestion = document.getElementById("profitConvertQuestion");
    const profitConvertTargetGroup = document.getElementById("profitConvertTargetGroup");
    const profitConvertTarget = document.getElementById("profitConvertTarget");
    const profitConvertPreviewGroup = document.getElementById("profitConvertPreviewGroup");
    const profitConvertPreview = document.getElementById("profitConvertPreview");
    const countryProfitGrid = document.getElementById("countryProfitGrid");
    const operatorProfitFilter = document.getElementById("operatorProfitFilter");
    const operatorProfitDateFrom = document.getElementById("operatorProfitDateFrom");
    const operatorProfitDateTo = document.getElementById("operatorProfitDateTo");
    const resetOperatorProfitFiltersBtn = document.getElementById("resetOperatorProfitFiltersBtn");
    const operatorSelectedName = document.getElementById("operatorSelectedName");
    const operatorProfitTotal = document.getElementById("operatorProfitTotal");
    const operatorProfitTotalCur = document.getElementById("operatorProfitTotalCur");
    const operatorProfitPaid = document.getElementById("operatorProfitPaid");
    const operatorProfitPaidCur = document.getElementById("operatorProfitPaidCur");
    const operatorProfitPending = document.getElementById("operatorProfitPending");
    const operatorProfitPendingCur = document.getElementById("operatorProfitPendingCur");
    const operatorProfitBody = document.getElementById("operatorProfitBody");
    const operatorProfitEmpty = document.getElementById("operatorProfitEmpty");
    const operatorProfitCountryGrid = document.getElementById("operatorProfitCountryGrid");
    const operatorProfitCountryEmpty = document.getElementById("operatorProfitCountryEmpty");
    const profileFullName = document.getElementById("profileFullName");
    const profilePhone = document.getElementById("profilePhone");
    const profileResidenceCountry = document.getElementById("profileResidenceCountry");
    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const profileReminderBtn = document.getElementById("profileReminderBtn");
    const profileIncompleteNotice = document.getElementById("profileIncompleteNotice");
        const profileReminderCard = document.getElementById("profileReminderCard");
    const profileNavBtn = document.getElementById("profileNavBtn");
        const sidebarProfileBtn = document.getElementById("sidebarProfileBtn");

    const registerOperationBtn = document.getElementById("registerOperationBtn");
    const heroRegisterBtn = document.getElementById("heroRegisterBtn");


    let selectedProfit = null;
    let calcEnabled = false;
    let lastDataSnapshot = null;
    let showAllRates = false;
    let pendingRegisterData = null;
    let COUNTRY_TRADE_RATES = {};
    const calcBidirectional = new Map();

    const currencyMapRaw = {
      "argentina":"ARS","bolivia":"BOB","brasil":"BRL","brazil":"BRL","chile":"CLP","colombia":"COP","ecuador":"USD",
      "estados unidos":"USD","usa":"USD","united states":"USD","eeuu":"USD","mexico":"MXN","méxico":"MXN","panama":"USD",
      "panamá":"USD","paraguay":"PYG","peru":"PEN","perú":"PEN","uruguay":"UYU","venezuela":"VES","espana":"EUR",
      "españa":"EUR","spain":"EUR","republica dominicana":"DOP","república dominicana":"DOP","costa rica":"CRC","el salvador":"USD",
      "honduras":"HNL","guatemala":"GTQ","nicaragua":"NIO","canada":"CAD","canadá":"CAD","europe":"EUR","union europea":"EUR","unión europea":"EUR"
    };

    const currencyMap = (() => {
      const m = new Map();
      Object.entries(currencyMapRaw).forEach(([k,v]) => m.set(norm(k), v));
      return m;
    })();

    function norm(s){
      return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function keyFor(o,d){
      return norm(o) + "|" + norm(d);
    }

    function getCurrencyFor(name){
      const n = norm(name);
      if(currencyMap.has(n)) return currencyMap.get(n);
      const clean = String(name || "").trim().toUpperCase();
      return clean ? clean.slice(0,3) : "MON";
    }

    function showToast(msg){
      toastEl.textContent = msg;
      toastEl.style.opacity = 0;
      toastEl.style.display = "block";
      requestAnimationFrame(() => { toastEl.style.opacity = 1; });
      setTimeout(() => {
        toastEl.style.opacity = 0;
        setTimeout(() => { toastEl.style.display = "none"; }, 250);
      }, 1400);
    }

    let onzeInitialViewLoading = true;
    window.addEventListener("load", function(){
      setTimeout(function(){
        onzeInitialViewLoading = false;
      }, 600);
    });

    try{
      for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);
        const value = String(localStorage.getItem(key) || "").trim();
        if(value === "provider-control"){
          localStorage.setItem(key, "inicio");
        }
      }
    }catch(e){}

    function switchView(viewName){
      // Normalize "home" to "inicio"
      if(viewName === "home") viewName = "inicio";

      // Al refrescar, no dejar Control proveedores como pantalla inicial
      if(onzeInitialViewLoading && viewName === "provider-control"){
        viewName = "inicio";
      }

      if(viewName === "provider-pending"){
        setTimeout(()=>{
          if(typeof renderProviderPendingFullView === "function"){
            renderProviderPendingFullView();
          }
        }, 120);
      }

      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

      const targetView = document.getElementById(`view-${viewName}`);
      if(targetView) targetView.classList.add("active");

      const navBtn = document.querySelector(`.nav-btn[data-view-target="${viewName}"]`);
      if(navBtn) navBtn.classList.add("active");

      try{
        localStorage.setItem("onze_active_view", viewName);
      }catch{}

      sidebar.classList.remove("open");
    }

    async function copyText(text){
      try{
        await navigator.clipboard.writeText(text);
        showToast("Copiado ✅");
      }catch{
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try{
          document.execCommand("copy");
          showToast("Copiado ✅");
        }catch{
          onzeAlert("No se pudo copiar");
        }
        ta.remove();
      }
    }

    function roundHalfUp(value, decimals){
      const f = Math.pow(10, decimals);
      const x = value * f;
      const sign = x < 0 ? -1 : 1;
      const abs = Math.abs(x);
      const rounded = Math.floor(abs + 0.5);
      return (sign * rounded) / f;
    }

    function countDecimalsFromText(str){
      if(!str) return 0;
      const s = String(str).trim();
      if(!s) return 0;
      const useComma = s.includes(",") && (s.lastIndexOf(",") > s.lastIndexOf("."));
      if(useComma){
        const i = s.lastIndexOf(",");
        return i >= 0 ? (s.length - i - 1) : 0;
      }
      const i = s.lastIndexOf(".");
      return i >= 0 ? (s.length - i - 1) : 0;
    }

    function fmtCL(value, decimals){
      const n = Number(value);
      if(!Number.isFinite(n)) return "—";
      return n.toLocaleString("es-CL", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: false
      });
    }

    function fmtPct(p){
      const s = String(p);
      return s.endsWith(".0") ? s.slice(0, -2) : s;
    }

    function parseHumanNumber(value){
      let s = String(value ?? "").trim();
      if(!s) return NaN;
      s = s.replace(/\./g, "").replace(/,/g, ".").replace(/\s+/g, "");
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }

    function currencyDecimals(currency){
      return ["CLP","ARS","COP","VES","PYG"].includes(currency) ? 0 : 2;
    }

    function formatCalcValue(value, currency){
      if(!isFinite(value)) return "";
      const decimals = currencyDecimals(currency);
      return new Intl.NumberFormat("es-CL", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(roundHalfUp(value, decimals));
    }

    function todayISO(){
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,"0");
      const day = String(d.getDate()).padStart(2,"0");
      return `${y}-${m}-${day}`;
    }

    function formatDateTimeForTable(isoDate, createdAt){
      const d = createdAt ? new Date(createdAt) : new Date(isoDate);
      return new Intl.DateTimeFormat("es-CL", {
        year:"numeric",
        month:"2-digit",
        day:"2-digit",
        hour:"2-digit",
        minute:"2-digit"
      }).format(d);
    }

    function stripBOM(t){
      return t && t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
    }

    function parseCSV(text){
      text = stripBOM(text);
      const rows = [];
      let row = [], cur = "", inQuotes = false;

      for(let i=0;i<text.length;i++){
        const c = text[i], n = text[i+1];
        if(c === '"'){
          if(inQuotes && n === '"'){ cur += '"'; i++; }
          else inQuotes = !inQuotes;
        }else if(c === "," && !inQuotes){
          row.push(cur);
          cur = "";
        }else if((c === "\n" || c === "\r") && !inQuotes){
          if(cur !== "" || row.length){
            row.push(cur);
            rows.push(row);
            row = [];
            cur = "";
          }
          if(c === "\r" && n === "\n") i++;
        }else{
          cur += c;
        }
      }

      if(cur !== "" || row.length){
        row.push(cur);
        rows.push(row);
      }

      return rows;
    }

    function parseRate(str){
      if(str == null) return NaN;
      let s = String(str).trim();
      if(!s) return NaN;

      const low = s.toLowerCase();
      if(low.includes("error") || low.includes("#div/0") || low.includes("#n/a") || low.includes("#ref") || low.includes("#value")) return NaN;

      s = s.replace(/\$/g, "").replace(/\s+/g, "");

      if(s.includes(",") && (s.lastIndexOf(",") > s.lastIndexOf("."))){
        s = s.replace(/\./g, "").replace(",", ".");
      }else{
        s = s.replace(/,/g, "");
      }

      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }

    const EXCEPTIONS_UP = new Set([
      keyFor("Argentina","USA"), keyFor("Chile","Ecuador"), keyFor("Chile","España"), keyFor("Chile","USA"),
      keyFor("Colombia","USA"), keyFor("Colombia","Venezuela"), keyFor("Peru","Ecuador")
    ]);

    const OP_DIV_OVERRIDES = new Set([
      keyFor("Argentina","USA"), keyFor("Chile","Ecuador"), keyFor("Chile","España"), keyFor("Chile","USA"),
      keyFor("Colombia","USA"), keyFor("Colombia","Venezuela"), keyFor("Peru","Ecuador")
    ]);

    function findHeaderIndexes(rows){
      const candid = ["origen","pais origen","origen pais","pais"];
      const candd = ["destino","pais destino","destino pais"];
      const candt = ["tasa","tasas","rate","valor","tipo de cambio","tipo cambio"];
      const candCost = ["tasa costo","costo","coste","cost rate","provider cost"];
      const candRetail = ["tasa detal","tasa detail","detail","retail","retail rate","tasa retail"];
      const cande = ["decimales","decimals","precision"];
      const candm = ["modo","ajuste","signo","sentido"];
      const cando = ["operacion","operación","calc","calculo","cálculo","op"];

      for(let r=0;r<Math.min(rows.length,10);r++){
        const hdr = rows[r].map(norm);
        const iOrigen = hdr.findIndex(h => candid.includes(h));
        const iDestino = hdr.findIndex(h => candd.includes(h));
        const iTasa = hdr.findIndex(h => candt.includes(h));
        if(iOrigen >= 0 && iDestino >= 0 && iTasa >= 0){
          return {
            row:r,
            iOrigen,
            iDestino,
            iTasa,
            iTasaCosto: hdr.findIndex(h => candCost.includes(h)),
            iTasaDetal: hdr.findIndex(h => candRetail.includes(h)),
            iDecimales: hdr.findIndex(h => cande.includes(h)),
            iModo: hdr.findIndex(h => candm.includes(h)),
            iOperacion: hdr.findIndex(h => cando.includes(h))
          };
        }
      }
      return null;
    }

    function buildCountryTradeRates(rows){
      const map = {};
      let started = false;

      for(const row of rows){
        const countryCell = String(row[6] || "").trim();
        const buyCell = row[7];
        const sellCell = row[8];
        const countryNorm = norm(countryCell);

        if(!started){
          if(countryNorm === "pais" && norm(row[7] || "") === "compra" && norm(row[8] || "") === "venta"){
            started = true;
          }
          continue;
        }

        if(!countryCell) continue;

        const buy = parseRate(buyCell);
        const sell = parseRate(sellCell);

        map[norm(countryCell)] = {
          buy: Number.isFinite(buy) ? buy : null,
          sell: Number.isFinite(sell) ? sell : null
        };
      }

      return map;
    }

    function buildDataRobust(rows){
      const idx = findHeaderIndexes(rows);
      if(!idx) throw new Error("No encontré encabezados. Asegúrate de tener columnas Origen | Destino | Tasa.");
      const start = idx.row + 1;
      const tmp = {};

      for(let r=start;r<rows.length;r++){
        const row = rows[r];
        const origen = String(row[idx.iOrigen] || "").trim();
        const destino = String(row[idx.iDestino] || "").trim();
        const tasaText = row[idx.iTasa];
        const tasaCostoText = idx.iTasaCosto >= 0 ? row[idx.iTasaCosto] : "";
        const tasaDetalText = idx.iTasaDetal >= 0 ? row[idx.iTasaDetal] : "";
        if(!origen || !destino) continue;

        const rateNum = parseRate(tasaText);
        const costRateNum = parseRate(tasaCostoText);
        const retailRateNum = parseRate(tasaDetalText);

        let decimals = 0;
        if(idx.iDecimales >= 0){
          const d = Number(String(row[idx.iDecimales] || "").trim());
          decimals = Number.isInteger(d) ? Math.max(0, Math.min(12, d)) : countDecimalsFromText(tasaDetalText || tasaText);
        }else{
          decimals = countDecimalsFromText(tasaDetalText || tasaText);
        }

        if(keyFor(origen, destino) === keyFor("España","Venezuela")){
          decimals = Math.min(decimals, 4);
        }

        let mode = "down";
        if(idx.iModo >= 0){
          const raw = norm(row[idx.iModo] || "");
          if(raw === "+" || raw === "mas" || raw === "sube" || raw === "up" || raw === "aumenta") mode = "up";
          if(raw === "-" || raw === "menos" || raw === "baja" || raw === "down" || raw === "disminuye") mode = "down";
        }else{
          mode = EXCEPTIONS_UP.has(keyFor(origen,destino)) ? "up" : "down";
        }

        let op = "mul";
        if(idx.iOperacion >= 0){
          const rop = norm(row[idx.iOperacion] || "");
          if(rop === "div" || rop === "/" || rop === "÷" || rop === "division" || rop === "dividir") op = "div";
          if(rop === "mul" || rop === "*" || rop === "x" || rop === "multiplicar" || rop === "multi") op = "mul";
        }else if(OP_DIV_OVERRIDES.has(keyFor(origen,destino))){
          op = "div";
        }

        let displayValueText = String(tasaText ?? "").trim();
        let displayProviderRateText = String(tasaText ?? "").trim();

        if(!tmp[origen]) tmp[origen] = [];
        tmp[origen].push({
          dest: destino,
          value: isFinite(rateNum) ? rateNum : null,
          valueText: displayValueText,
          providerRate: isFinite(rateNum) ? rateNum : null,
          providerRateText: displayProviderRateText,
          costRate: isFinite(costRateNum) ? costRateNum : null,
          costRateText: String(tasaCostoText ?? "").trim(),
          retailRate: isFinite(retailRateNum) ? retailRateNum : null,
          retailRateText: String(tasaDetalText ?? "").trim(),
          decimals,
          mode,
          op
        });
      }

      const origins = Object.keys(tmp).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
      origins.forEach(o => tmp[o].sort((a,b)=>a.dest.localeCompare(b.dest,"es",{sensitivity:"base"})));
      return {origins, data: tmp, countryTradeRates: buildCountryTradeRates(rows)};
    }

    function getCountryTradeRate(country, side){
      const entry = COUNTRY_TRADE_RATES[norm(country || "")];
      if(!entry) return null;
      const value = side === "buy" ? entry.buy : entry.sell;
      return Number.isFinite(value) ? value : null;
    }

    function toUsdtFromCountryAmount(country, amount){
      const buyRate = getCountryTradeRate(country, "buy");
      const numericAmount = Number(amount);
      if(!Number.isFinite(buyRate) || !Number.isFinite(numericAmount) || buyRate <= 0) return 0;
      return numericAmount / buyRate;
    }

    function populateCountries(origins, prevValue){
      sel.innerHTML = '<option value="" selected>Selecciona un país…</option>';
      origins.forEach(p=>{
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
      });

      const preferredCountry = String(prevValue || restoredCountry || "").trim();
      if(preferredCountry && origins.includes(preferredCountry)){
        sel.value = preferredCountry;
      }
    }

    function populateDestinations(data, origin, prevDest=""){
      destSel.innerHTML = '<option value="" selected>Selecciona un destino…</option>';
      if(!origin || !data[origin] || !data[origin].length){
        destSel.disabled = true;
        viewAllBtn.disabled = true;
        return;
      }

      data[origin].forEach(item=>{
        const opt = document.createElement("option");
        opt.value = item.dest;
        opt.textContent = item.dest;
        destSel.appendChild(opt);
      });

      destSel.disabled = false;
      viewAllBtn.disabled = false;

      const preferredDest = String(prevDest || restoredDestination || "").trim();
      if(preferredDest && data[origin].some(x => x.dest === preferredDest)){
        destSel.value = preferredDest;
      }
    }

    function adjustedValue(base, percent, mode){
      if(base == null || !isFinite(base)) return null;
      const p = percent / 100;
      return mode === "up" ? base * (1 + p) : base * (1 - p);
    }

    function rateForCalc(item){
      const retailRate = item?.retailRate ?? null;

      if(isFreeOperator()){
        if(selectedProfit == null) return item.value;
        return adjustedValue(item.value, Number(selectedProfit), item.mode);
      }

      if(isOnzeCalculator()){
        return getOnzeImprovedRetailRate(item);
      }

      return retailRate;
    }

    function applyOp(amount, rate, op){
      if(!isFinite(amount) || !isFinite(rate) || rate === 0) return NaN;
      return op === "div" ? (amount / rate) : (amount * rate);
    }

    function invertOp(amount, rate, op){
      if(!isFinite(amount) || !isFinite(rate)) return NaN;
      return op === "div" ? (amount * rate) : (rate === 0 ? NaN : amount / rate);
    }

    function getCalcState(rowKey){
      if(!calcBidirectional.has(rowKey)) calcBidirectional.set(rowKey, {origin:"", dest:"", active:"origin"});
      return calcBidirectional.get(rowKey);
    }

    function getBalanceSummaryByCountry(){
      const summaryMap = new Map();

      const normalizeCountryLabel = (country) => {
        const raw = String(country || "").trim();
        if(!raw) return "";
        if(norm(raw) === "usdt") return "USDT";
        return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      };

      const ensureEntry = (country, currency) => {
        const normalizedCountry = normalizeCountryLabel(country);
        const normalizedCurrency = String(currency || "").trim().toUpperCase();
        const key = `${norm(normalizedCountry)}__${normalizedCurrency}`;
        if(!summaryMap.has(key)){
          summaryMap.set(key, {
            country: normalizedCountry,
            currency: normalizedCurrency,
            initialCapitalId: "",
            capitalInicial: 0,
            entradas: 0,
            salidas: 0,
            saldoActual: 0,
            saldoUsdt: 0
          });
        }
        return summaryMap.get(key);
      };

      loadInitialCapital().forEach(item => {
        const entry = ensureEntry(item.country, item.currency);
        if(!entry.initialCapitalId && item.id !== undefined && item.id !== null){
          entry.initialCapitalId = String(item.id);
        }
        entry.capitalInicial += Number(item.amount || 0);
      });

      loadOperations()
        .filter(op => !op.deleted)
        .forEach(op => {
          const originEntry = ensureEntry(op.originCountry, op.originCurrency);
          originEntry.entradas += Number(op.sendAmount || 0);

          const destEntry = ensureEntry(op.destCountry, op.destCurrency);
          destEntry.salidas += Number(op.receiveAmount || 0);
        });

      loadExpenses().forEach(exp => {
        const country = String(exp.country || "").trim();
        const currency = String(exp.currency || "").trim().toUpperCase();
        const amount = Number(exp.amount || 0);
        if(!country || !currency || !Number.isFinite(amount) || amount <= 0) return;

        const entry = ensureEntry(country, currency);
        entry.salidas += amount;
      });

      const rows = Array.from(summaryMap.values()).map(entry => {
        entry.saldoActual = Number(entry.capitalInicial || 0) + Number(entry.entradas || 0) - Number(entry.salidas || 0);
        entry.saldoUsdt = toUsdtFromCountryAmount(entry.country, entry.saldoActual);
        return entry;
      });

      rows.sort((a, b) => a.country.localeCompare(b.country, "es", { sensitivity: "base" }));
      return rows;
    }

    function currentFilteredArray(data){
      const pais = sel.value;
      const destino = destSel.value;

      if(!pais || !data[pais]) return [];
      if(showAllRates) return data[pais];
      if(destino) return data[pais].filter(item => item.dest === destino);
      return [];
    }

    let operationsCache = [];

    function loadOperations(){
      return Array.isArray(operationsCache) ? operationsCache : [];
    }

    function saveOperations(ops){
      operationsCache = Array.isArray(ops) ? ops : [];
    }

    async function fetchOperationsFromApi(){
      try{
        const res = await fetch("/api/operations", { cache: "no-store" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudieron cargar las operaciones.");
        }

        const ops = (Array.isArray(data?.operations) ? data.operations : []).map(op => {
          const originCurrency = op.originCurrency || "";
          const destCurrency = op.destCurrency || "";
          const profitCurrency = op.profitCurrency || originCurrency || "";
          const providerRate = Number(op.providerRate);
          const clientRate = Number(op.clientRate);
          const profitValue = Number(op.profitValue || 0);

          return {
            ...op,
            onzeProfitUsdt: op.onzeProfitUsdt !== null && op.onzeProfitUsdt !== undefined
              ? Number(op.onzeProfitUsdt)
              : null,
            onzeProfitOriginAmount: op.onzeProfitOriginAmount !== null && op.onzeProfitOriginAmount !== undefined
              ? Number(op.onzeProfitOriginAmount)
              : null,
            onzeProfitOriginCurrencyCode: op.onzeProfitOriginCurrencyCode || originCurrency || "",
            sendAmountFormatted: `${formatCalcValue(Number(op.sendAmount || 0), originCurrency)} ${originCurrency}`.trim(),
            receiveAmountFormatted: `${formatCalcValue(Number(op.receiveAmount || 0), destCurrency)} ${destCurrency}`.trim(),
            providerRateFormatted: Number.isFinite(providerRate)
              ? fmtCL(providerRate, Math.abs(providerRate) < 1 ? 5 : 2)
              : "—",
            clientRateFormatted: Number.isFinite(clientRate)
              ? fmtCL(clientRate, Math.abs(clientRate) < 1 ? 5 : 2)
              : "—",
            profitDisplay: `${formatCalcValue(Math.abs(profitValue), profitCurrency)} ${profitCurrency}`.trim()
          };
        });
        saveOperations(ops);
        return ops;
      }catch(error){
        console.error("FETCH_OPERATIONS_ERROR", error);
        return loadOperations();
      }
    }

    let capitalCache = [];

    function loadInitialCapital(){
      return Array.isArray(capitalCache) ? capitalCache : [];
    }

    function saveInitialCapital(items){
      capitalCache = Array.isArray(items) ? items : [];
    }

    async function fetchCapitalFromApi(){
      try{
        const res = await fetch("/api/capital", { cache: "no-store" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudo cargar el capital inicial.");
        }

        const items = Array.isArray(data?.items) ? data.items : [];
        saveInitialCapital(items);
        return items;
      }catch(error){
        console.error("FETCH_CAPITAL_ERROR", error);
        return loadInitialCapital();
      }
    }

    function loadBalanceMovements(){
      try{
        const raw = localStorage.getItem(BALANCE_MOVEMENTS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveBalanceMovements(items){
      localStorage.setItem(BALANCE_MOVEMENTS_KEY, JSON.stringify(items));
    }

    function loadLiquidityAlerts(){
      try{
        const raw = localStorage.getItem(LIQUIDITY_ALERTS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveLiquidityAlerts(items){
      localStorage.setItem(LIQUIDITY_ALERTS_KEY, JSON.stringify(items));
    }

    function loadInternalFundings(){
      try{
        const raw = localStorage.getItem(INTERNAL_FUNDINGS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveInternalFundings(items){
      localStorage.setItem(INTERNAL_FUNDINGS_KEY, JSON.stringify(items));
    }

    function loadEarningsMovements(){
      try{
        const raw = localStorage.getItem(EARNINGS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveEarningsMovements(items){
      localStorage.setItem(EARNINGS_KEY, JSON.stringify(items));
    }

    function loadCollaboratorPayments(){
      try{
        const raw = localStorage.getItem(COLLABORATOR_PAYMENTS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveCollaboratorPayments(items){
      localStorage.setItem(COLLABORATOR_PAYMENTS_KEY, JSON.stringify(items));
    }

    let expensesCache = [];

    function loadExpenses(){
      return Array.isArray(expensesCache) ? expensesCache : [];
    }

    function saveExpenses(expenses){
      expensesCache = Array.isArray(expenses) ? expenses : [];
    }

    async function fetchExpensesFromApi(){
      try{
        const res = await fetch("/api/expenses", { cache: "no-store" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudieron cargar los gastos.");
        }

        const items = Array.isArray(data?.expenses) ? data.expenses : [];
        saveExpenses(items);
        return items;
      }catch(error){
        console.error("FETCH_EXPENSES_ERROR", error);
        return loadExpenses();
      }
    }

    function loadSavedClients(){
      try{
        const raw = localStorage.getItem(CLIENTS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch{
        return [];
      }
    }

    function saveSavedClients(clients){
      localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
    }

    function createSimpleId(prefix){
      return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    }

    function getCountryBalanceSnapshot(countryName, currencyCode){
      const targetCountry = norm(countryName || "");
      const targetCurrency = String(currencyCode || "").trim().toUpperCase();

      const capital = loadInitialCapital().filter(item =>
        norm(item.country || "") === targetCountry &&
        String(item.currency || "").trim().toUpperCase() === targetCurrency
      );

      const movements = loadBalanceMovements().filter(item =>
        norm(item.country || "") === targetCountry &&
        String(item.currency || "").trim().toUpperCase() === targetCurrency
      );

      const capitalTotal = capital.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const movementNet = movements.reduce((sum, item) => {
        const amount = Number(item.amount || 0);
        return sum + (item.direction === "entrada" ? amount : -amount);
      }, 0);

      return {
        country: targetCountry,
        currency: targetCurrency,
        capitalTotal,
        movementNet,
        balance: capitalTotal + movementNet
      };
    }

    function addBalanceMovement({
      operationId = "",
      fundingId = "",
      country = "",
      currency = "",
      direction = "entrada",
      movementType = "ajuste_manual",
      amount = 0,
      note = ""
    } = {}){
      const movements = loadBalanceMovements();
      movements.push({
        id: createSimpleId("bal"),
        createdAt: new Date().toISOString(),
        operationId,
        fundingId,
        country,
        currency: String(currency || "").trim().toUpperCase(),
        direction,
        movementType,
        amount: Number(amount || 0),
        note
      });
      saveBalanceMovements(movements);
    }


    function rebuildBalanceMovementsFromOperations(ops = loadOperations()){
      const existingMovements = loadBalanceMovements();

      const manualMovements = existingMovements.filter(item => {
        const type = String(item.movementType || "").trim().toLowerCase();
        return type !== "operacion_entrada" && type !== "operacion_salida";
      });

      const rebuiltOperationMovements = [];
      ops.forEach(op => {
        rebuiltOperationMovements.push({
          id: createSimpleId("bal"),
          createdAt: op.createdAt || new Date().toISOString(),
          operationId: op.id || "",
          fundingId: "",
          country: op.originCountry || "",
          currency: String(op.originCurrency || "").trim().toUpperCase(),
          direction: "entrada",
          movementType: "operacion_entrada",
          amount: Number(op.sendAmount || 0),
          note: `Operación ${op.operationNumber || ""}`.trim()
        });

        rebuiltOperationMovements.push({
          id: createSimpleId("bal"),
          createdAt: op.createdAt || new Date().toISOString(),
          operationId: op.id || "",
          fundingId: "",
          country: op.destCountry || "",
          currency: String(op.destCurrency || "").trim().toUpperCase(),
          direction: "salida",
          movementType: "operacion_salida",
          amount: Number(op.receiveAmount || 0),
          note: `Operación ${op.operationNumber || ""}`.trim()
        });
      });

      saveBalanceMovements([...manualMovements, ...rebuiltOperationMovements]);
    }

    function addLiquidityAlert({
      operationId = "",
      country = "",
      currency = "",
      availableAmount = 0,
      requiredAmount = 0,
      shortageAmount = 0,
      note = ""
    } = {}){
      const alerts = loadLiquidityAlerts();
      alerts.push({
        id: createSimpleId("liq"),
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        status: "abierta",
        operationId,
        country,
        currency: String(currency || "").trim().toUpperCase(),
        availableAmount: Number(availableAmount || 0),
        requiredAmount: Number(requiredAmount || 0),
        shortageAmount: Number(shortageAmount || 0),
        note
      });
      saveLiquidityAlerts(alerts);
    }

    function renderInitialCapital(){
      if(!capitalInitialGrid || !capitalInitialEmpty) return;

      const items = getBalanceSummaryByCountry().filter(item =>
        String(item.initialCapitalId || "").trim() !== ""
      );

      capitalInitialGrid.innerHTML = "";

      if(!items.length){
        capitalInitialEmpty.style.display = "block";
        return;
      }

      capitalInitialEmpty.style.display = "none";

      items.forEach(item => {
        const deleteId = String(item.initialCapitalId || "");

        const div = document.createElement("div");
        div.className = "capital-card";
        div.innerHTML = `
          <div class="capital-card-head">
            <div>
              <div class="capital-card-country">${item.country || "—"}</div>
              <div class="capital-card-currency">${item.currency || ""}</div>
            </div>
            <div class="capital-card-flag">${getFlagEmoji(item.country || "")}</div>
          </div>
          <div>
            <div class="dash-label">Saldo actual</div>
            <div class="capital-card-amount">${formatCalcValue(Number(item.saldoActual || 0), item.currency || "")}</div>
          </div>
          <div class="capital-metrics">
            <div class="capital-metric entrada">
              <div class="capital-metric-label">Entradas</div>
              <div class="capital-metric-value">${formatCalcValue(Number(item.entradas || 0), item.currency || "")}</div>
            </div>
            <div class="capital-metric salida">
              <div class="capital-metric-label">Salidas</div>
              <div class="capital-metric-value">${formatCalcValue(Number(item.salidas || 0), item.currency || "")}</div>
            </div>
          </div>
          <div class="capital-card-actions">
            <button class="p2p-action-main-btn" type="button" onclick="openCountryDetail('${item.country || ""}')" title="Ver detalle" aria-label="Ver detalle" style="min-height:38px;padding:0 14px;font-size:13px;"><svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></svg></button>
            ${deleteId ? `<button class="btn small danger" type="button" onclick="deleteInitialCapital('${deleteId}')" title="Eliminar capital" aria-label="Eliminar capital">🗑️</button>` : ""}
          </div>
        `;
        capitalInitialGrid.appendChild(div);
      });
    }

    let pendingCapitalActionId = null;

    function closeCapitalActionModal(){
      if(!capitalActionModal) return;
      capitalActionModal.classList.remove("open");
      capitalActionModal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("noscroll");
      pendingCapitalActionId = null;
    }

    function openCapitalActionModal(id){
      const items = loadInitialCapital();
      const current = items.find(item => String(item.id) === String(id));
      if(!current || !capitalActionModal) return;

      pendingCapitalActionId = id;
      if(capitalActionCountry) capitalActionCountry.textContent = current.country || "—";
      if(capitalActionCurrency) capitalActionCurrency.textContent = current.currency || "—";

      capitalActionModal.classList.add("open");
      capitalActionModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("noscroll");
    }

    async function applyCapitalCardAction(action){
      if(!pendingCapitalActionId) return;

      const items = loadInitialCapital();
      const current = items.find(item => String(item.id) === String(pendingCapitalActionId));
      if(!current) {
        closeCapitalActionModal();
        return;
      }

      const normalizeText = value => String(value || "").trim().toLowerCase();

      let movements = [];
      try {
        movements = JSON.parse(localStorage.getItem(BALANCE_MOVEMENTS_KEY) || "[]");
      } catch(e) {
        movements = [];
      }

      const sameCardMovement = item =>
        normalizeText(item.country) === normalizeText(current.country) &&
        normalizeText(item.currency) === normalizeText(current.currency);

      if(action === "delete"){
        try{
          const res = await fetch(`/api/capital/${pendingCapitalActionId}`, { method: "DELETE" });
          const data = await res.json().catch(()=>({}));

          if(!res.ok){
            throw new Error(data?.error || "No se pudo eliminar el capital inicial.");
          }

          await fetchCapitalFromApi();

          const cleanedMovements = movements.filter(item => !sameCardMovement(item));
          localStorage.setItem(BALANCE_MOVEMENTS_KEY, JSON.stringify(cleanedMovements));

          closeCapitalActionModal();
          renderInitialCapital();
          refreshDashboard();
          if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
            renderCountryDetail(pendingCountryDetail);
          }
          if(typeof showToast === 'function') showToast('Tarjeta completa eliminada');
        }catch(error){
          console.error("DELETE_CAPITAL_ERROR", error);
          if(typeof showToast === 'function') showToast(error?.message || 'No se pudo eliminar el capital inicial');
        }
        return;
      }

      if(action === "reset"){
        const cleanedMovements = movements.filter(item => !sameCardMovement(item));
        localStorage.setItem(BALANCE_MOVEMENTS_KEY, JSON.stringify(cleanedMovements));

        closeCapitalActionModal();
        renderInitialCapital();
        refreshDashboard();
        if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
          renderCountryDetail(pendingCountryDetail);
        }
        if(typeof showToast === 'function') showToast('Movimientos reiniciados');
      }
    }

    window.deleteInitialCapital = function(id){
      openCapitalActionModal(id);
    };


    let pendingCountryDetail = "";

    function closeCountryDetailModal(){
      if(!countryDetailModal) return;
      countryDetailModal.classList.remove("open");
      countryDetailModal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("noscroll");
      pendingCountryDetail = "";
    }

    // "Historial de tasa" -- pedido explícito del usuario (ago 2026), solo
    // visible/accesible para super_admin_global (ver initRateHistoryButtonVisibility
    // más arriba y la autorización real en app/api/rate-history/route.ts).
    const rateHistoryModal = document.getElementById("rateHistoryModal");
    const rateHistoryBody = document.getElementById("rateHistoryBody");
    const rateHistoryEmpty = document.getElementById("rateHistoryEmpty");
    const rateHistoryRangeSelect = document.getElementById("rateHistoryRangeSelect");
    const rateHistoryDateInput = document.getElementById("rateHistoryDateInput");
    const rateHistorySearchBtn = document.getElementById("rateHistorySearchBtn");
    const rateHistoryCountryBtn = document.getElementById("rateHistoryCountryBtn");
    const rateHistoryCountryBtnLabel = document.getElementById("rateHistoryCountryBtnLabel");
    const rateHistoryCountryPanel = document.getElementById("rateHistoryCountryPanel");
    const rateHistoryCountryCheckboxes = document.getElementById("rateHistoryCountryCheckboxes");
    const rateHistoryCountryClearBtn = document.getElementById("rateHistoryCountryClearBtn");
    const rateHistoryCountryApplyBtn = document.getElementById("rateHistoryCountryApplyBtn");
    const rateHistoryDetailBar = document.getElementById("rateHistoryDetailBar");
    const rateHistoryDetailTitle = document.getElementById("rateHistoryDetailTitle");
    const rateHistoryBackBtn = document.getElementById("rateHistoryBackBtn");
    const rateHistoryChangesHead = document.getElementById("rateHistoryChangesHead");
    const closeRateHistoryModalBtn = document.getElementById("closeRateHistoryModalBtn");

    // Última respuesta cruda de la API (todas las filas del rango elegido,
    // ordenadas país asc + hora desc) -- pedido explícito del usuario (ago
    // 2026): la lista principal debe mostrar la tasa ACTUAL de cada país con
    // un conteo de cuántas veces cambió en el rango, no cada fila suelta.
    // El detalle (todas las filas de un país puntual) se arma agrupando
    // esto mismo en el cliente, sin pedir de nuevo al servidor.
    let rateHistoryRawRows = [];
    let rateHistoryDetailCountry = "";
    // Países marcados (checkboxes) -- vacío = ver todos. Pedido explícito
    // del usuario (ago 2026): poder ver la tasa del día de 2+ países a la
    // vez, no solo uno por uno.
    let rateHistorySelectedCountries = new Set();

    function rateHistoryCountryLabel(){
      const n = rateHistorySelectedCountries.size;
      if(n === 0) return "Todos los países";
      if(n === 1) return Array.from(rateHistorySelectedCountries)[0];
      return `${n} países`;
    }

    function rateHistoryUpdateCountryBtnLabel(){
      if(rateHistoryCountryBtnLabel) rateHistoryCountryBtnLabel.textContent = rateHistoryCountryLabel();
    }

    function closeRateHistoryCountryPanel(){
      if(!rateHistoryCountryPanel) return;
      rateHistoryCountryPanel.style.display = "none";
      if(rateHistoryCountryBtn) rateHistoryCountryBtn.setAttribute("aria-expanded", "false");
    }

    if(rateHistoryCountryBtn) rateHistoryCountryBtn.addEventListener("click", function(e){
      e.stopPropagation();
      if(!rateHistoryCountryPanel) return;
      const open = rateHistoryCountryPanel.style.display === "flex";
      rateHistoryCountryPanel.style.display = open ? "none" : "flex";
      rateHistoryCountryBtn.setAttribute("aria-expanded", open ? "false" : "true");
    });
    if(rateHistoryCountryPanel) rateHistoryCountryPanel.addEventListener("click", (e)=>e.stopPropagation());
    document.addEventListener("click", function(e){
      if(!rateHistoryCountryPanel || rateHistoryCountryPanel.style.display !== "flex") return;
      if(!e.target.closest("#rateHistoryCountryPanel") && !e.target.closest("#rateHistoryCountryBtn")) closeRateHistoryCountryPanel();
    });
    document.addEventListener("keydown", function(e){
      if(e.key === "Escape") closeRateHistoryCountryPanel();
    });

    if(rateHistoryCountryClearBtn) rateHistoryCountryClearBtn.addEventListener("click", function(){
      rateHistorySelectedCountries = new Set();
      if(rateHistoryCountryCheckboxes){
        rateHistoryCountryCheckboxes.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = false);
      }
      rateHistoryUpdateCountryBtnLabel();
      rateHistoryDetailCountry = "";
      closeRateHistoryCountryPanel();
      renderRateHistory();
    });
    if(rateHistoryCountryApplyBtn) rateHistoryCountryApplyBtn.addEventListener("click", function(){
      rateHistoryDetailCountry = "";
      closeRateHistoryCountryPanel();
      renderRateHistory();
    });
    if(rateHistoryCountryCheckboxes) rateHistoryCountryCheckboxes.addEventListener("change", function(e){
      const cb = e.target.closest("input[type=checkbox]");
      if(!cb) return;
      if(cb.checked) rateHistorySelectedCountries.add(cb.value);
      else rateHistorySelectedCountries.delete(cb.value);
      rateHistoryUpdateCountryBtnLabel();
    });

    function closeRateHistoryModal(){
      if(!rateHistoryModal) return;
      rateHistoryModal.classList.remove("open");
      rateHistoryModal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("noscroll");
    }

    if(closeRateHistoryModalBtn) closeRateHistoryModalBtn.addEventListener("click", closeRateHistoryModal);

    if(rateHistoryRangeSelect) rateHistoryRangeSelect.addEventListener("change", function(){
      const isCustom = rateHistoryRangeSelect.value === "custom";
      if(rateHistoryDateInput) rateHistoryDateInput.style.display = isCustom ? "inline-block" : "none";
      if(rateHistorySearchBtn) rateHistorySearchBtn.style.display = isCustom ? "inline-block" : "none";
      rateHistoryDetailCountry = "";
      if(isCustom){
        if(rateHistoryDateInput && !rateHistoryDateInput.value) rateHistoryDateInput.value = todayISO();
        loadRateHistory();
      }else{
        loadRateHistory();
      }
    });
    if(rateHistorySearchBtn) rateHistorySearchBtn.addEventListener("click", function(){ rateHistoryDetailCountry = ""; loadRateHistory(); });
    if(rateHistoryBackBtn) rateHistoryBackBtn.addEventListener("click", function(){
      rateHistoryDetailCountry = "";
      renderRateHistory();
    });
    // Delegado (no onclick inline) -- el país va como atributo data-, nunca
    // embebido en JS dentro del HTML: un país con comillas en el JSON
    // rompía el atributo onclick en silencio (bug real confirmado en vivo,
    // ago 2026, el botón "Detalle" no hacía nada).
    if(rateHistoryBody) rateHistoryBody.addEventListener("click", function(ev){
      const btn = ev.target.closest("[data-rate-detail]");
      if(!btn) return;
      rateHistoryDetailCountry = btn.getAttribute("data-rate-detail") || "";
      renderRateHistory();
    });

    // Copia local de escHtml -- NO depender de la función global del mismo
    // nombre (definida en otro <script> más abajo en el archivo). Caso real
    // (ago 2026): en un momento esa función no estaba disponible todavía y
    // el ReferenceError resultante quedaba SIN CAPTURAR justo dentro del
    // catch de abajo, dejando el modal pegado en "Cargando..." para siempre
    // en vez de mostrar el error real -- la función de arriba nunca llegaba
    // a actualizar el HTML porque el error nuevo interrumpía todo antes.
    function rateHistoryEsc(str){
      if(!str) return "";
      return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    function rateHistoryFmtWhen(iso){
      return new Intl.DateTimeFormat("es-CL", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit" }).format(new Date(iso));
    }

    function rateHistoryFmtRate(v){
      return v != null ? fmtCL(Number(v), countDecimalsFromText(String(v))) : "—";
    }

    // Reconstruye los checkboxes de país a partir de los países presentes
    // en el rango cargado, preservando la selección previa (rateHistorySelectedCountries)
    // para los países que sigan existiendo en el nuevo rango.
    function rebuildRateHistoryCountrySelect(){
      if(!rateHistoryCountryCheckboxes) return;
      const countries = Array.from(new Set(rateHistoryRawRows.map(r => r.country))).sort();
      rateHistorySelectedCountries = new Set(Array.from(rateHistorySelectedCountries).filter(c => countries.includes(c)));
      rateHistoryCountryCheckboxes.innerHTML = countries.map(c => {
        const flag = typeof getFlagEmoji === "function" ? getFlagEmoji(c) : "";
        const checked = rateHistorySelectedCountries.has(c) ? "checked" : "";
        const id = "rhc_" + rateHistoryEsc(c).replace(/[^a-zA-Z0-9]/g, "_");
        return `<label for="${id}" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="${id}" value="${rateHistoryEsc(c)}" ${checked}>
          ${flag} ${rateHistoryEsc(c)}
        </label>`;
      }).join("");
      rateHistoryUpdateCountryBtnLabel();
    }

    // Vista agrupada: una fila por país con su tasa MÁS RECIENTE dentro del
    // rango y cuántas veces cambió -- botón "Detalle" abre la vista de
    // abajo con cada cambio individual y su hora. El filtro de país acepta
    // 2 o más países a la vez (rateHistorySelectedCountries) -- pedido
    // explícito del usuario (ago 2026): comparar varios países del mismo día
    // sin tener que abrir uno por uno.
    function renderRateHistoryGrouped(){
      if(rateHistoryDetailBar) rateHistoryDetailBar.style.display = "none";
      if(rateHistoryChangesHead) rateHistoryChangesHead.textContent = "Cambios";
      const byCountry = new Map();
      for(const r of rateHistoryRawRows){
        if(rateHistorySelectedCountries.size > 0 && !rateHistorySelectedCountries.has(r.country)) continue;
        if(!byCountry.has(r.country)) byCountry.set(r.country, []);
        byCountry.get(r.country).push(r);
      }
      const countries = Array.from(byCountry.keys()).sort();
      if(!countries.length){
        rateHistoryBody.innerHTML = "";
        if(rateHistoryEmpty) rateHistoryEmpty.style.display = "block";
        return;
      }
      if(rateHistoryEmpty) rateHistoryEmpty.style.display = "none";
      rateHistoryBody.innerHTML = countries.map(country => {
        const changes = byCountry.get(country); // ya viene ordenado hora desc
        const latest = changes[0];
        const flag = typeof getFlagEmoji === "function" ? getFlagEmoji(country) : "";
        const n = changes.length;
        const changesLabel = n === 1 ? "1 cambio" : `${n} cambios`;
        return `
          <tr>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${flag} ${rateHistoryEsc(country)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${rateHistoryFmtRate(latest.buyRate)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${rateHistoryFmtRate(latest.sellRate)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);color:#94a3b8;">${rateHistoryFmtWhen(latest.recordedAt)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">
              ${changesLabel}
              <button type="button" data-rate-detail="${rateHistoryEsc(country)}" title="Ver detalle" style="margin-left:8px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.08);color:#94a3b8;cursor:pointer;font-size:14px;transition:all .12s;" onmouseover="this.style.background='rgba(148,163,184,.16)';this.style.color='#e2e8f0';" onmouseout="this.style.background='rgba(148,163,184,.08)';this.style.color='#94a3b8';">📖</button>
            </td>
          </tr>`;
      }).join("");
    }

    // Vista de detalle: todos los cambios de UN país, más antiguo abajo,
    // más reciente arriba (mismo orden que ya traía la API).
    function renderRateHistoryDetail(country){
      const changes = rateHistoryRawRows.filter(r => r.country === country);
      if(rateHistoryDetailBar) rateHistoryDetailBar.style.display = "flex";
      if(rateHistoryDetailTitle){
        const flag = typeof getFlagEmoji === "function" ? getFlagEmoji(country) : "";
        rateHistoryDetailTitle.textContent = `${flag} ${country} — ${changes.length === 1 ? "1 cambio" : changes.length + " cambios"} en este rango`;
      }
      if(rateHistoryChangesHead) rateHistoryChangesHead.textContent = "";
      if(!changes.length){
        rateHistoryBody.innerHTML = "";
        if(rateHistoryEmpty) rateHistoryEmpty.style.display = "block";
        return;
      }
      if(rateHistoryEmpty) rateHistoryEmpty.style.display = "none";
      rateHistoryBody.innerHTML = changes.map((r, i) => {
        const flag = typeof getFlagEmoji === "function" ? getFlagEmoji(r.country) : "";
        const tag = i === 0 ? " <span style=\"color:#34d399;font-size:11px;\">(actual)</span>" : "";
        return `
          <tr>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${flag} ${rateHistoryEsc(r.country)}${tag}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${rateHistoryFmtRate(r.buyRate)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${rateHistoryFmtRate(r.sellRate)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);color:#94a3b8;">${rateHistoryFmtWhen(r.recordedAt)}</td>
            <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);"></td>
          </tr>`;
      }).join("");
    }

    function renderRateHistory(){
      if(!rateHistoryBody) return;
      if(rateHistoryDetailCountry){
        renderRateHistoryDetail(rateHistoryDetailCountry);
      }else{
        renderRateHistoryGrouped();
      }
    }

    async function loadRateHistory(){
      if(!rateHistoryBody) return;
      rateHistoryBody.innerHTML = `<tr><td colspan="5" style="padding:14px;color:#64748b;font-size:12px;">Cargando…</td></tr>`;
      if(rateHistoryEmpty) rateHistoryEmpty.style.display = "none";
      if(rateHistoryDetailBar) rateHistoryDetailBar.style.display = "none";

      const isCustom = rateHistoryRangeSelect && rateHistoryRangeSelect.value === "custom";
      const query = isCustom
        ? "date=" + encodeURIComponent(rateHistoryDateInput ? rateHistoryDateInput.value : todayISO())
        : "days=" + encodeURIComponent(rateHistoryRangeSelect ? rateHistoryRangeSelect.value : "1");
      try{
        // Timeout de seguridad -- mismo caso real que ya se vio en el
        // historial de ciclos: el navegador puede tener la petición en cola
        // detrás del polling constante del bot (cada ~300ms) y quedarse
        // pegado en "Cargando..." sin límite. Sin esto no había forma de
        // saber si de verdad estaba fallando o solo esperando en la cola.
        const abortCtrl = new AbortController();
        const timeoutId = setTimeout(() => abortCtrl.abort(), 15000);
        let res;
        try{
          res = await fetch("/api/rate-history?" + query, { credentials: "include", cache: "no-store", signal: abortCtrl.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        let data = null;
        try{ data = await res.json(); }catch{}
        if(!data?.ok){
          // Muestra el motivo real (status HTTP + mensaje del servidor) en vez
          // de un mensaje genérico -- caso real (ago 2026): sin esto no había
          // forma de saber si era un problema de sesión (403), del servidor
          // (500), o de red, y quedaba imposible de diagnosticar a distancia.
          const reason = data?.error || ("HTTP " + res.status);
          console.error("[rate-history]", reason);
          rateHistoryBody.innerHTML = `<tr><td colspan="5" style="padding:14px;color:#f87171;font-size:12px;">No se pudo cargar el historial (${rateHistoryEsc(reason)}).</td></tr>`;
          return;
        }
        rateHistoryRawRows = data.rows || [];
        rebuildRateHistoryCountrySelect();
        renderRateHistory();
      }catch(e){
        console.error("[rate-history]", e);
        const reason = e?.name === "AbortError" ? "tardó demasiado, reintenta" : String(e?.message || e);
        rateHistoryBody.innerHTML = `<tr><td colspan="5" style="padding:14px;color:#f87171;font-size:12px;">No se pudo cargar el historial (${rateHistoryEsc(reason)}).</td></tr>`;
      }
    }

    window.openRateHistoryModal = function(){
      if(!rateHistoryModal || !isGlobalAdmin()) return;
      rateHistoryModal.classList.add("open");
      rateHistoryModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("noscroll");
      rateHistoryDetailCountry = "";
      loadRateHistory();
    };

    function getCountryDetailRows(country){
      const target = String(country || "").trim().toLowerCase();
      if(!target) return [];

      const operationRows = loadOperations()
        .filter(op =>
          String(op.originCountry || "").trim().toLowerCase() === target ||
          String(op.destCountry || "").trim().toLowerCase() === target
        )
        .map(op => ({ kind: "operation", ...op }));

      const expenseRows = loadExpenses()
        .filter(exp => String(exp.country || "").trim().toLowerCase() === target)
        .map(exp => ({ kind: "expense", ...exp }));

      return [...operationRows, ...expenseRows]
        .sort((a,b)=>new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
    }

    function renderCountryDetail(country){
      const selectedCountry = String(country || "").trim();
      if(!selectedCountry) return;

      pendingCountryDetail = selectedCountry;

      const summary = getBalanceSummaryByCountry().find(
        item => String(item.country || "").trim().toLowerCase() === selectedCountry.toLowerCase()
      );

      if(countryDetailSelect){
        const countries = getBalanceSummaryByCountry().map(item => item.country).filter(Boolean);
        countryDetailSelect.innerHTML =
          '<option value="">Selecciona un país…</option>' +
          countries.map(c => `<option value="${c}">${getFlagEmoji(c)} ${c}</option>`).join('');
        countryDetailSelect.value = selectedCountry;
      }

      if(countryDetailTitle){
        countryDetailTitle.textContent = `${getFlagEmoji(selectedCountry)} Movimientos de ${selectedCountry}`;
      }
      if(countryDetailCurrency) countryDetailCurrency.textContent = summary?.currency || "—";
      if(countryDetailBalance) countryDetailBalance.textContent = summary ? formatCalcValue(Number(summary.saldoActual || 0), summary.currency || "") : "0";
      if(countryDetailEntries) countryDetailEntries.textContent = summary ? formatCalcValue(Number(summary.entradas || 0), summary.currency || "") : "0";
      if(countryDetailExits) countryDetailExits.textContent = summary ? formatCalcValue(Number(summary.salidas || 0), summary.currency || "") : "0";

      const rows = getCountryDetailRows(selectedCountry);
      if(countryDetailCount) countryDetailCount.textContent = String(rows.length);
      if(countryDetailBody) countryDetailBody.innerHTML = "";

      if(!rows.length){
        if(countryDetailEmpty) countryDetailEmpty.style.display = "block";
        return;
      }

      if(countryDetailEmpty) countryDetailEmpty.style.display = "none";

      rows.forEach(op => {
        const isExpense = op.kind === "expense";

        const isOrigin = String(op.originCountry || "").trim().toLowerCase() === selectedCountry.toLowerCase();
        const movementType = isExpense ? "Gasto" : (isOrigin ? "Entrada" : "Salida");
        const movementAmount = isExpense
          ? `${formatCalcValue(Number(op.amount || 0), op.currency || "USDT")} ${op.currency || "USDT"}`
          : (isOrigin
              ? (op.sendAmountFormatted || formatCalcValue(Number(op.sendAmount || 0), op.originCurrency || ""))
              : (op.receiveAmountFormatted || formatCalcValue(Number(op.receiveAmount || 0), op.destCurrency || "")));

        const stateHtml = isExpense
          ? '<span class="pill" style="background:rgba(245,158,11,.12);color:#fcd34d;border:1px solid rgba(245,158,11,.25);">Gasto</span>'
          : (op.deleted
              ? '<span class="pill danger">Anulada</span>'
              : '<span class="pill green">Activa</span>');

        const clientOrCategory = isExpense ? (op.category || "Gasto") : (op.clientName || "—");
        const routeOrNote = isExpense
          ? `${op.country || "—"}${op.note ? " · " + op.note : ""}`
          : `${op.originCountry || "—"} → ${op.destCountry || "—"}`;

        const operatorName = isExpense ? "—" : (getOperatorDisplayName(op) || "—");

        let onzeProfitUsdtHtml = "—";
        if(!isExpense && !op.deleted){
          const roundedUsdt = Math.round(Number(op?.onzeProfitUsdt || 0) * 10) / 10;
          onzeProfitUsdtHtml = `${formatCalcValue(roundedUsdt, "USDT")} USDT`;
        }

        const tr = document.createElement("tr");
        if(op.deleted) tr.style.opacity = "0.5";

        tr.innerHTML = `
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${formatDateTimeForTable(op.date, op.createdAt)}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${operatorName}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${clientOrCategory}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${movementType}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${routeOrNote}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${movementAmount}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${isExpense ? "—" : (op.deleted ? '<span class="pill danger">No contabiliza</span>' : onzeProfitUsdtHtml)}</td>
          <td style="padding:10px;border-top:1px solid rgba(255,255,255,.06);">${stateHtml}</td>
        `;

        if(op.deleted){
          Array.from(tr.children).forEach(td => {
            td.style.textDecoration = "line-through";
            td.style.textDecorationThickness = "2px";
            td.style.textDecorationColor = "rgba(255,255,255,.75)";
          });
        }

        countryDetailBody.appendChild(tr);
      });
    }

    function openCountryDetailModal(country){
      if(!countryDetailModal) return;
      countryDetailModal.classList.add("open");
      countryDetailModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("noscroll");
      renderCountryDetail(country);
    }

    window.openCountryDetail = function(country){
      openCountryDetailModal(country);
    };


    function renderExpenses(){
      if(!expensesBody || !expensesEmpty) return;

      const expenses = loadExpenses().sort((a,b)=>new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      expensesBody.innerHTML = "";

      if(!expenses.length){
        expensesEmpty.style.display = "block";
        return;
      }

      expensesEmpty.style.display = "none";

      expenses.forEach(exp => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${exp.date || "—"}</td>
          <td>${exp.category || "—"}</td>
          <td>${formatCalcValue(Number(exp.amount || 0), exp.currency || "USDT")} ${exp.currency || "USDT"}</td>
          <td>${exp.country || "—"}${exp.note ? ` · ${exp.note}` : ""}</td>
          <td><button class="btn small danger" type="button" onclick="deleteExpense('${exp.id}')">Eliminar</button></td>
        `;
        expensesBody.appendChild(tr);
      });
    }

    window.deleteExpense = async function(id){
      if(!(await onzeConfirm("¿Seguro que deseas eliminar este gasto?"))) return;

      try{
        const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudo eliminar el gasto.");
        }

        await fetchExpensesFromApi();
        renderExpenses();
        renderInitialCapital();
        refreshDashboard();
        if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
          renderCountryDetail(pendingCountryDetail);
        }
        if(typeof showToast === 'function') showToast('Gasto eliminado');
      }catch(error){
        console.error("DELETE_EXPENSE_ERROR", error);
        if(typeof showToast === 'function') showToast(error?.message || 'No se pudo eliminar el gasto');
      }
    };

    window.deleteOperation = async function(id){
      if(!(await onzeConfirm("¿Seguro que deseas anular esta operación? Quedará visible en historial pero no afectará el balance."))) return;

      try{
        const res = await fetch(`/api/operations/${id}`, { method: "PATCH" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudo anular la operación.");
        }

        const latestOps = await fetchOperationsFromApi();
        saveOperations(latestOps);

        rebuildBalanceMovementsFromOperations((latestOps || []).filter(op => !op.deleted));

        const liquidityAlerts = loadLiquidityAlerts().filter(item => String(item.operationId) !== String(id));
        saveLiquidityAlerts(liquidityAlerts);

        const internalFundings = loadInternalFundings().filter(item => String(item.operationId) !== String(id));
        saveInternalFundings(internalFundings);

        refreshHistoryUI();
        renderInitialCapital();
        refreshDashboard((latestOps || []).filter(op => !op.deleted));
        if(typeof showToast === 'function') showToast('Operación anulada');
      }catch(error){
        console.error("DELETE_OPERATION_ERROR", error);
        if(typeof showToast === 'function') showToast(error?.message || 'No se pudo anular la operación');
      }
    };

    function applyRoleUIRestrictions(){
      if(!IS_ADMIN_ROLE){
        if(openOperatorProfitBtn){
          openOperatorProfitBtn.style.display = "none";
        }
        const operatorProfitView = document.getElementById("view-operator-profit");
        if(operatorProfitView){
          operatorProfitView.style.display = "none";
        }
      }

      if(IS_ADMIN_ROLE) return;

      const capitalSection = saveCapitalBtn?.closest(".section-card");
      if(capitalSection) capitalSection.style.display = "none";

      const expensesSection = addExpenseBtn?.closest(".section-card");
      if(expensesSection) expensesSection.style.display = "none";

      if(openCapitalSetupBtn){
        openCapitalSetupBtn.style.display = "none";
      }

      const openCapitalBtnCard = openCapitalSetupBtn?.closest(".dash-card");
      if(openCapitalBtnCard) openCapitalBtnCard.style.display = "none";

      const capitalTotalCard = dashUsdtCapital?.closest(".dash-card");
      if(capitalTotalCard) capitalTotalCard.style.display = "none";

      const monthExpensesCard = dashMonthExpenses?.closest(".dash-card");
      if(monthExpensesCard) monthExpensesCard.style.display = "none";

      const netBalanceCard = dashNetBalance?.closest(".dash-card");
      if(netBalanceCard) netBalanceCard.style.display = "none";

      const receivablesCountCard = dashReceivablesCount?.closest(".dash-card");
      if(receivablesCountCard) receivablesCountCard.style.display = "none";

      const receivablesUsdtCard = dashReceivablesUsdt?.closest(".dash-card");
      if(receivablesUsdtCard) receivablesUsdtCard.style.display = "none";

      const usdtCollectedCard = dashUsdtCollected?.closest(".dash-card");
      if(usdtCollectedCard) usdtCollectedCard.style.display = "none";

      const usdtPendingCard = dashUsdtPending?.closest(".dash-card");
      if(usdtPendingCard) usdtPendingCard.style.display = "none";

      const countriesTotalCard = dashCountriesTotal?.closest(".dash-card");
      if(countriesTotalCard) countriesTotalCard.style.display = "none";
    }

    function rememberClient(name){
      const clean = String(name || "").trim();
      if(!clean) return;
      const clients = loadSavedClients();
      if(!clients.some(c => String(c).trim().toLowerCase() === clean.toLowerCase())){
        clients.push(clean);
        clients.sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
        saveSavedClients(clients);
      }
      refreshClientSuggestions();
    }

    function loadProfile(){
      try{
        const raw = localStorage.getItem(PROFILE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return data && typeof data === "object" ? data : {};
      }catch{
        return {};
      }
    }

    function saveProfile(data){
      localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
    }

    function isProfileComplete(profile = loadProfile()){
      return Boolean(
        String(profile.fullName || "").trim() &&
        String(profile.phone || "").trim() &&
        String(profile.residenceCountry || "").trim()
      );
    }

    function populateCountrySelect(selectEl){
      if(!selectEl) return;
      const countries = lastDataSnapshot ? Object.keys(lastDataSnapshot).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})) : [];
      const current = selectEl.value || "";
      selectEl.innerHTML = '<option value="">Selecciona un país…</option>' + countries.map(country => `<option value="${country}">${getFlagEmoji(country)} ${country}</option>`).join("");
      if(current && countries.includes(current)) selectEl.value = current;
    }

    function fillProfileForm(){
      const profile = loadProfile();
      if(profileFullName) profileFullName.value = profile.fullName || "";
      if(profilePhone) profilePhone.value = profile.phone || "";
      if(profileResidenceCountry){
        populateCountrySelect(profileResidenceCountry);
        profileResidenceCountry.value = profile.residenceCountry || "";
      }
      updateProfileUI();
    }

    function updateProfileUI(){
      const complete = isProfileComplete();
      if(profileIncompleteNotice) profileIncompleteNotice.style.display = complete ? "none" : "flex";
      if(profileReminderCard) profileReminderCard.style.display = complete ? "none" : "flex";
      const sidebarProfileBtnNow = document.getElementById("sidebarProfileBtn");
      if(sidebarProfileBtnNow){
        if(complete){
          sidebarProfileBtnNow.classList.remove("profile-jump-start");
        }
      }
    }

    function requireProfileForAction(message){
      const ok = isProfileComplete();
      if(ok) return true;
      onzeAlert(message || "Debes completar tu perfil primero.");
      switchView("profile");
      setTimeout(() => {
        profileFullName?.focus();
      }, 80);
      return false;
    }

    function refreshClientSuggestions(){
      const clients = loadSavedClients();
      if(!clientSuggestionsList) return;
      clientSuggestionsList.innerHTML = clients.map(name => `<option value="${name.replace(/"/g,'&quot;')}"></option>`).join("");
    }

    function getNextOperationNumber(){
      const ops = loadOperations();
      const maxNum = ops.reduce((acc, op) => {
        const n = parseInt(String(op.operationNumber || "").replace(/\D/g, ""), 10);
        return Number.isFinite(n) ? Math.max(acc, n) : acc;
      }, 0);
      return String(maxNum + 1).padStart(3, "0");
    }

    function inferProfitCountry(op){
      if(op.profitCountry) return op.profitCountry;
      if(op.profitCurrency && op.profitCurrency === op.originCurrency) return op.originCountry;
      if(op.profitCurrency && op.profitCurrency === op.destCurrency) return op.destCountry;
      return op.originCountry || "—";
    }

    function getProviderRoute(originCountry, targetCountry){
      if(!lastDataSnapshot || !originCountry || !targetCountry || !lastDataSnapshot[originCountry]) return null;
      return (lastDataSnapshot[originCountry] || []).find(item => item.dest === targetCountry) || null;
    }

    function formatCurrencyAmount(value, currency){
      return `${formatCalcValue(Number(value || 0), currency)} ${currency}`;
    }

    function getCurrentProfitBase(){
      if(!pendingRegisterData) return null;

      if(pendingRegisterData.operatorMode === "socio"){
        const payerSide = document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze";
        const value = payerSide === "socio"
          ? Number(pendingRegisterData.usdtDestValue || 0) + Number(pendingRegisterData.partnerProfitUsdt || 0)
          : Number(pendingRegisterData.partnerProfitUsdt || 0);

        return {
          country: "USDT",
          currency: "USDT",
          value
        };
      }

      return {
        country: pendingRegisterData.originCountry,
        currency: pendingRegisterData.originCurrency,
        value: Number(pendingRegisterData.profitOriginValue || 0)
      };
    }

    function refreshProfitConvertUI(){
      const base = getCurrentProfitBase();
      if(!base || !profitConvertQuestionGroup) return;

      profitConvertQuestionGroup.style.display = "";
      const shouldConvert = document.querySelector('input[name="profitConvertChoice"]:checked')?.value === "yes";

      if(!shouldConvert){
        profitConvertTargetGroup.style.display = "none";
        profitConvertPreviewGroup.style.display = "";
        profitConvertPreview.textContent = `${formatCalcValue(base.value, base.currency)} ${base.currency}`;
        const rn = document.getElementById('profitConvertRateNote');
        if(rn) rn.textContent = '';
        return;
      }

      const countries = lastDataSnapshot ? Object.keys(lastDataSnapshot).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})) : [];
      profitConvertTarget.innerHTML = '<option value="">Selecciona un país…</option>' + countries
        .filter(country => country !== base.country)
        .map(country => `<option value="${country}">${getFlagEmoji(country)} ${country}</option>`)
        .join("");

      profitConvertTargetGroup.style.display = "";
      profitConvertPreviewGroup.style.display = "";
      updateProfitConvertPreview();
    }

    function updateProfitConvertPreview(){
      const base = getCurrentProfitBase();
      if(!base) return;

      const shouldConvert = document.querySelector('input[name="profitConvertChoice"]:checked')?.value === "yes";
      const targetCountry = profitConvertTarget?.value || "";

      function ensureRateNote(){
        let el = document.getElementById('profitConvertRateNote');
        if(!el){
          const previewGroup = document.getElementById('profitConvertPreviewGroup');
          if(previewGroup){
            el = document.createElement('div');
            el.id = 'profitConvertRateNote';
            el.style.marginTop = '8px';
            el.style.fontSize = '13px';
            el.style.color = '#9fb4d4';
            el.style.lineHeight = '1.45';
            previewGroup.appendChild(el);
          }
        }
        return el;
      }

      const rateNote = ensureRateNote();

      if(!shouldConvert || !targetCountry){
        profitConvertPreview.textContent = `${formatCalcValue(base.value, base.currency)} ${base.currency}`;
        if(rateNote) rateNote.textContent = '';
        return;
      }

      if(pendingRegisterData?.operatorMode === "socio"){
        const sellRate = getCountryTradeRate(targetCountry, "sell");
        if(!Number.isFinite(sellRate)){
          profitConvertPreview.textContent = `No hay tasa de venta para ${targetCountry}`;
          if(rateNote) rateNote.textContent = '';
          return;
        }

        const targetCurrency = getCurrencyFor(targetCountry);
        const converted = Number(base.value || 0) * Number(sellRate || 0);
        const rateTxt = fmtCL(sellRate, 2);
        profitConvertPreview.textContent = `${formatCalcValue(converted, targetCurrency)} ${targetCurrency}`;
        if(rateNote) rateNote.textContent = `Tasa venta usada: ${targetCountry} = ${rateTxt}`;
        return;
      }

      const route = getProviderRoute(base.country, targetCountry);
      if(!route || !isFinite(route.value)){
        profitConvertPreview.textContent = `No hay tasa proveedor para ${base.country} → ${targetCountry}`;
        if(rateNote) rateNote.textContent = '';
        return;
      }

      const targetCurrency = getCurrencyFor(targetCountry);
      const converted = applyOp(Number(base.value || 0), Number(route.value), route.op);
      const rateTxt = fmtCL(route.value, route.decimals);
      profitConvertPreview.textContent = `${formatCalcValue(converted, targetCurrency)} ${targetCurrency}`;
      if(rateNote) rateNote.textContent = `Tasa proveedor usada: ${base.country} → ${targetCountry} = ${rateTxt}`;
    }

    function getDashboardProfitMeta(op){
      if(IS_ADMIN_ROLE){
        if(op?.onzeProfitUsdt !== null && op?.onzeProfitUsdt !== undefined){
          const roundedUsdt = Math.round(Number(op?.onzeProfitUsdt || 0) * 10) / 10;
          const originCountry = op?.originCountry || "—";
          const originCurrency = op?.originCurrency || op?.onzeProfitOriginCurrencyCode || "MON";
          const buyRate = Number(op?.buyOriginValue || 0);
          let visualOriginAmount = Number.isFinite(buyRate) && buyRate > 0
            ? roundedUsdt * buyRate
            : Number(op?.onzeProfitOriginAmount || 0);

          if(String(originCurrency).trim().toUpperCase() === "CLP"){
            visualOriginAmount = Math.round(visualOriginAmount);
          }

          return {
            country: originCountry,
            currency: originCurrency,
            amount: visualOriginAmount
          };
        }

        if(op?.onzeProfitOriginAmount !== null && op?.onzeProfitOriginAmount !== undefined){
          let amount = Number(op?.onzeProfitOriginAmount || 0);
          const currency = op?.onzeProfitOriginCurrencyCode || op?.originCurrency || "MON";

          if(String(currency).trim().toUpperCase() === "CLP"){
            amount = Math.round(amount);
          }

          return {
            country: op?.originCountry || "—",
            currency: currency,
            amount: amount
          };
        }

        return {
          country: "USDT",
          currency: "USDT",
          amount: 0
        };
      }

      return {
        country: op?.profitCountry || op?.originCountry || "—",
        currency: op?.profitCurrency || op?.originCurrency || "MON",
        amount: Number(op?.profitValue || 0)
      };
    }

    function getFlagEmoji(country){
      const map = {
        "Argentina":"🇦🇷","Bolivia":"🇧🇴","Brasil":"🇧🇷","Brazil":"🇧🇷","Chile":"🇨🇱","Colombia":"🇨🇴",
        "Ecuador":"🇪🇨","España":"🇪🇸","Spain":"🇪🇸","Perú":"🇵🇪","Peru":"🇵🇪","Uruguay":"🇺🇾",
        "Venezuela":"🇻🇪","Paraguay":"🇵🇾","México":"🇲🇽","Mexico":"🇲🇽","Estados Unidos":"🇺🇸",
        "USA":"🇺🇸","United States":"🇺🇸","Panamá":"🇵🇦","Panama":"🇵🇦","Costa Rica":"🇨🇷",
        "República Dominicana":"🇩🇴","Republica Dominicana":"🇩🇴","Dominicana":"🇩🇴","Guatemala":"🇬🇹",
        "Honduras":"🇭🇳","Nicaragua":"🇳🇮","El Salvador":"🇸🇻","Puerto Rico":"🇵🇷","Canadá":"🇨🇦",
        "Canada":"🇨🇦","Italia":"🇮🇹","Francia":"🇫🇷","France":"🇫🇷","Alemania":"🇩🇪","Germany":"🇩🇪"
      };
      const clean = String(country || "").trim();
      return map[clean] || "";
    }



    function aggregateCountryProfit(ops){
      const groups = new Map();

      ops.forEach(op => {
        const meta = getDashboardProfitMeta(op);
        const profitCountry = meta.country;
        const profitCurrency = meta.currency;
        const amount = Number(meta.amount || 0);

        const key = `${profitCountry}|${profitCurrency}`;

        if(!groups.has(key)){
          groups.set(key, {
            profitCountry,
            profitCurrency,
            total: 0
          });
        }

        groups.get(key).total += amount;
      });

      return Array.from(groups.values()).sort((a,b)=>a.profitCountry.localeCompare(b.profitCountry,"es",{sensitivity:"base"}));
    }

    function renderCountryProfit(ops = loadOperations()){
      if(!countryProfitGrid) return;

      const groups = aggregateCountryProfit(ops);

      if(!groups.length){
        countryProfitGrid.innerHTML = `<div class="empty-state country-profit-empty" style="display:block;">Todavía no hay ganancias por país.</div>`;
        return;
      }

      countryProfitGrid.innerHTML = groups.map(group => `
        <div class="country-profit-item" style="padding:18px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(67,124,255,.22);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-size:13px;letter-spacing:.4px;text-transform:uppercase;color:#9fb4d4;font-weight:800;">
                ${getFlagEmoji(group.profitCountry)} ${group.profitCountry}
              </div>
              <div style="margin-top:10px;font-size:30px;font-weight:900;line-height:1;color:#fff;">
                ${formatCalcValue(Number(group.total || 0), group.profitCurrency)}
              </div>
              <div style="margin-top:6px;font-size:13px;color:#8ea7cf;font-weight:700;">
                ${group.profitCurrency}
              </div>
            </div>
          </div>
        </div>
      `).join("");
    }



// ===== OPERATOR PROFIT =====

function getOperatorDisplayName(op){
  return String(
    op?.createdByUserName ||
    op?.createdByName ||
    op?.userName ||
    op?.createdByUserEmail ||
    "Sin operador"
  ).trim();
}

function getOperatorModeLabel(op){
  const mode = String(op?.operatorMode || "").trim().toLowerCase();

  if(mode === "socio") return "Socio 50/50";
  if(mode === "porcentaje"){
    const raw = String(op?.marginLabel || "").trim();
    return raw ? `Porcentaje ${raw}` : "Porcentaje";
  }
  if(mode === "libre") return "Libre";
  if(mode === "manual") return "ONZE";
  return "—";
}

function getOperatorPayMeta(op){
  const amount = Number(
    op?.operatorProfitFinalAmount ??
    op?.payoutAmountToOperator ??
    op?.payoutUsdtAmount ??
    op?.profitValue ??
    0
  );

  const currency = String(
    op?.operatorProfitFinalCurrencyCode ||
    op?.payoutCurrencyCode ||
    op?.profitCurrency ||
    op?.originCurrency ||
    "MON"
  ).trim().toUpperCase() || "MON";

  return { amount, currency };
}

function getOperatorPayCountry(op){
  const finalCurrency = String(
    op?.operatorProfitFinalCurrencyCode ||
    op?.payoutCurrencyCode ||
    op?.profitCurrency ||
    op?.originCurrency ||
    ""
  ).trim().toUpperCase();

  const originCurrency = String(op?.originCurrency || "").trim().toUpperCase();
  const profitCurrency = String(op?.profitCurrency || "").trim().toUpperCase();

  if(finalCurrency === "USDT") return "USDT";
  if(finalCurrency && profitCurrency && finalCurrency === profitCurrency && op?.profitCountry){
    return op.profitCountry;
  }
  if(finalCurrency && originCurrency && finalCurrency === originCurrency && op?.originCountry){
    return op.originCountry;
  }
  return op?.profitCountry || op?.originCountry || "";
}

function getOperatorPayUsdt(op){
  const meta = getOperatorPayMeta(op);
  const currency = String(meta.currency || "").trim().toUpperCase();
  const amount = Number(meta.amount || 0);

  if(!Number.isFinite(amount) || amount === 0) return 0;
  if(currency === "USDT") return amount;

  const country = getOperatorPayCountry(op);
  return Number(toUsdtFromCountryAmount(country, amount) || 0);
}

function getOperatorProfitFilteredOps(ops = loadOperations()){
  let items = (Array.isArray(ops) ? [...ops] : []).filter(op => {
    const mode = String(op?.operatorMode || "").trim().toLowerCase();
    return mode !== "manual";
  });

  const selectedName = operatorProfitFilter?.value || "";
  const dateFrom = operatorProfitDateFrom?.value || "";
  const dateTo = operatorProfitDateTo?.value || "";

  if(!selectedName){
    return [];
  }

  items = items.filter(op => getOperatorDisplayName(op) === selectedName);

  if(dateFrom){
    items = items.filter(op => String(op?.date || "").slice(0,10) >= dateFrom);
  }

  if(dateTo){
    items = items.filter(op => String(op?.date || "").slice(0,10) <= dateTo);
  }

  return items;
}

function aggregateOperatorProfit(ops){
  const groups = new Map();

  ops.forEach(op=>{
    const name = getOperatorDisplayName(op);
    const modeLabel = getOperatorModeLabel(op);
    const payMeta = getOperatorPayMeta(op);
    const key = `${name}|${modeLabel}|${payMeta.currency}`;

    if(!groups.has(key)){
      groups.set(key, {
        name,
        modeLabel,
        currency: payMeta.currency || "MON",
        total: 0
      });
    }

    groups.get(key).total += Number(payMeta.amount || 0);
  });

  return Array.from(groups.values()).sort((a,b)=>{
    if(a.name !== b.name) return a.name.localeCompare(b.name, "es", { sensitivity:"base" });
    if(a.modeLabel !== b.modeLabel) return a.modeLabel.localeCompare(b.modeLabel, "es", { sensitivity:"base" });
    return a.currency.localeCompare(b.currency, "es", { sensitivity:"base" });
  });
}

function aggregateOperatorProfitByCountry(ops){
  const groups = new Map();

  ops.forEach(op=>{
    const payMeta = getOperatorPayMeta(op);
    const country = getOperatorPayCountry(op);
    const currency = String(payMeta.currency || "").trim().toUpperCase() || "MON";

    if(!country) return;

    const key = `${country}|${currency}`;

    if(!groups.has(key)){
      groups.set(key, {
        country,
        currency,
        total: 0
      });
    }

    groups.get(key).total += Number(payMeta.amount || 0);
  });

  return Array.from(groups.values()).sort((a,b)=>
    a.country.localeCompare(b.country, "es", { sensitivity:"base" })
  );
}

function populateOperatorProfitFilter(ops = loadOperations()){
  if(!operatorProfitFilter) return;

  const currentValue = operatorProfitFilter.value || "";
  const names = Array.from(new Set(
    (Array.isArray(ops) ? ops : [])
      .filter(op => String(op?.operatorMode || "").trim().toLowerCase() !== "manual")
      .map(getOperatorDisplayName)
      .filter(Boolean)
  )).sort((a,b)=>a.localeCompare(b, "es", { sensitivity:"base" }));

  operatorProfitFilter.innerHTML = '<option value="">Todos los operadores</option>' +
    names.map(name => `<option value="${name}">${name}</option>`).join("");

  if(names.includes(currentValue)){
    operatorProfitFilter.value = currentValue;
  }
}

const PROVIDER_MOVEMENTS_KEY = "onzeProviderMovements";

function loadProviderMovements(){
      try{
        const raw = localStorage.getItem(PROVIDER_MOVEMENTS_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      }catch(e){
        return [];
      }
    }

    function saveProviderMovements(items){
      localStorage.setItem(PROVIDER_MOVEMENTS_KEY, JSON.stringify(items || []));
    }

    function getActiveProvidersByCountry(country){
      const cleanCountry = String(country || "").trim().toLowerCase();
      if(!cleanCountry) return [];

      return loadProviders().filter(provider =>
        String(provider.country || "").trim().toLowerCase() === cleanCountry &&
        (provider.status || "active") === "active"
      );
    }

    function buildProviderMovementFromOperation(op, savedOperationId){
      if(!op) return null;

      const originCountry = String(op.originCountry || "").trim();
      const destCountry = String(op.destCountry || "").trim();

      if(!originCountry && !destCountry) return null;

      const providers = loadProviders();
      const normalize = value => String(value || "").trim().toLowerCase();

      const originProviders = providers.filter(p => normalize(p.country) === normalize(originCountry));
      const destProviders = providers.filter(p => normalize(p.country) === normalize(destCountry));

      let country = "";
      let movementType = "";
      let amount = 0;
      let currency = "";

      if(originProviders.length){
        country = originCountry;
        movementType = "received";
        amount = Number(op.sendAmount || 0);
        currency = op.originCurrency || "";
      }else if(destProviders.length){
        country = destCountry;
        movementType = "paid";
        amount = Number(op.receiveAmount || 0);
        currency = op.destCurrency || "";
      }else{
        return null;
      }

      const activeProviders = getActiveProvidersByCountry(country);

      let providerId = null;
      let providerName = "";
      let status = "pending";

      if(activeProviders.length === 1){
        providerId = activeProviders[0].id;
        providerName = activeProviders[0].name || "";
        status = "assigned";
      }

      return {
        id: "pmov_" + Date.now() + "_" + Math.random().toString(16).slice(2),
        operationId: String(savedOperationId || op.id || ""),
        operationNumber: op.operationNumber || "",
        date: op.date || new Date().toISOString().slice(0,10),
        country,
        movementType,
        movementLabel: movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor",
        providerId,
        providerName,
        operatorId: op.operatorId || op.userId || op.createdById || op.registeredById || op.createdBy || op.registeredBy || "",
        operatorName: op.operatorName || op.createdByName || op.registeredByName || op.createdByFullName || op.registeredByFullName || op.fullName || op.profileFullName || op.displayName || op.name || op.userName || "",
        operatorEmail: op.operatorEmail || op.createdByEmail || op.registeredByEmail || op.email || "",
        status,
        source: "operation",
        originCountry,
        destCountry,
        originCurrency: op.originCurrency || "",
        destCurrency: op.destCurrency || "",
        amount,
        currency,
        sendAmount: Number(op.sendAmount || 0),
        receiveAmount: Number(op.receiveAmount || 0),
        providerRate: Number(movementType === "received" ? (op.buyOriginValue || op.providerRate || 0) : (op.sellDestinationValue || op.providerRate || 0)),
        clientRate: Number(op.clientRate || 0),
        createdAt: new Date().toISOString()
      };
    }

    function syncProviderMovementsFromOperations(ops){
      if(!IS_ADMIN_ROLE) return;

      const operations = Array.isArray(ops) ? ops : [];
      const movements = loadProviderMovements();
      let changed = false;

      operations
        .filter(op => op && !op.deleted)
        .forEach(op=>{
          const movement = buildProviderMovementFromOperation(op, op.id);
          if(!movement) return;

          const exists = movements.some(item =>
            String(item.operationId || "") === String(movement.operationId || "") ||
            (
              String(item.operationNumber || "") &&
              String(item.operationNumber || "") === String(movement.operationNumber || "")
            )
          );

          if(exists) return;

          movements.push(movement);
          changed = true;
        });

      if(changed){
        saveProviderMovements(movements);
        renderProvidersView();
      }
    }

    function registerProviderMovementFromOperation(op, savedOperationId){
      const movement = buildProviderMovementFromOperation(op, savedOperationId);
      if(!movement) return;

      const movements = loadProviderMovements();
      const exists = movements.some(item =>
        String(item.operationId || "") === String(movement.operationId || "") &&
        String(item.operationNumber || "") === String(movement.operationNumber || "")
      );

      if(exists) return;

      movements.push(movement);
      saveProviderMovements(movements);
    }

function updateProviderCurrencyFromCountry(){
      if(!providerCountryInput || !providerCurrencyInput) return;

      const selected = providerCountryInput.options[providerCountryInput.selectedIndex];
      const currency = selected ? (selected.dataset.currency || "") : "";

      providerCurrencyInput.value = currency;
    }

function loadProviders(){
      try{
        return JSON.parse(localStorage.getItem("onzeProviders") || "[]");
      }catch(e){
        return [];
      }
    }

    function saveProviders(items){
      localStorage.setItem("onzeProviders", JSON.stringify(items || []));
    }

    function renderProvidersView(){
      const providers = loadProviders();

      if(providersActiveCount){
        providersActiveCount.textContent = providers.filter(p => (p.status || "active") === "active").length;
      }

      if(providersOpenClosings){
        const pendingProviderMovements = loadProviderMovements().filter(item => (item.status || "pending") === "pending");
        providersOpenClosings.textContent = pendingProviderMovements.length;
      }

      if(providersLastClosing){
        providersLastClosing.textContent = "—";
      }

      if(!providersGrid || !providersEmpty) return;

      providersGrid.innerHTML = "";

      if(!providers.length){
        providersEmpty.style.display = "block";
        return;
      }

      providersEmpty.style.display = "none";

      providers.forEach(provider=>{
        const card = document.createElement("div");
        card.className = "dash-card";
        card.style.minHeight = "auto";

        const name = provider.name || "Proveedor";
        const country = provider.country || "—";
        const currency = provider.currency || "—";
        const status = provider.status || "active";

        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <div class="dash-label">${country}</div>
              <div class="dash-value" style="font-size:22px;">${name}</div>
              <div class="dash-sub">Moneda: ${currency}</div>
            </div>

            <button
              type="button"
              onclick="toggleProviderStatus('${provider.id}')"
              style="
                width:52px;
                height:30px;
                border:none;
                border-radius:999px;
                padding:3px;
                background:${status === "active" ? "#22c55e" : "#94a3b8"};
                cursor:pointer;
                display:flex;
                justify-content:${status === "active" ? "flex-end" : "flex-start"};
                align-items:center;
              "
              title="${status === "active" ? "Desactivar proveedor" : "Activar proveedor"}"
            >
              <span style="
                width:24px;
                height:24px;
                border-radius:50%;
                background:#fff;
                display:block;
                box-shadow:0 2px 6px rgba(0,0,0,.22);
              "></span>
            </button>
          </div>

          <div class="dash-sub" style="margin-top:10px;">
            Estado: <strong>${status === "active" ? "Activo" : "Inactivo"}</strong>
          </div>

          ${provider.note ? `<div class="dash-sub" style="margin-top:6px;">Nota: ${provider.note}</div>` : ""}

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn small secondary" type="button" onclick="openProviderControlDetail('${provider.id}')">Ver control</button>
            <button class="btn small ghost" type="button" onclick="openEditProviderModal('${provider.id}')">Editar</button>
          </div>
        `;

        providersGrid.appendChild(card);
      });
    }

    function renderProviderPendingFullView(){
      if(!providerPendingFullList) return;

      function formatPendingDateTime(value){
        if(!value) return "Sin fecha";

        const raw = String(value).trim();

        // Si viene solo fecha YYYY-MM-DD, mostrar solo fecha.
        if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
          const [y,m,d] = raw.split("-");
          return `${d}/${m}/${y}`;
        }

        // Si viene con hora ISO, convertir a hora local de Chile.
        const parsed = new Date(raw);
        if(!Number.isNaN(parsed.getTime())){
          return parsed.toLocaleString("es-CL", {
            timeZone: "America/Santiago",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
        }

        return raw;
      }

      const pending = loadProviderMovements()
        .filter(item => (item.status || "pending") === "pending")
        .sort((a,b)=> new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

      const countries = new Set(pending.map(item => item.country || "").filter(Boolean));
      const received = pending.filter(item => item.movementType === "received");
      const paid = pending.filter(item => item.movementType === "paid");

      if(providerPendingTotalCount) providerPendingTotalCount.textContent = pending.length;
      if(providerPendingCountriesCount) providerPendingCountriesCount.textContent = countries.size;
      if(providerPendingReceivedCount) providerPendingReceivedCount.textContent = received.length;
      if(providerPendingPaidCount) providerPendingPaidCount.textContent = paid.length;

      providerPendingFullList.innerHTML = "";

      if(!pending.length){
        providerPendingFullList.innerHTML = `<div class="empty-state">No hay movimientos pendientes por asignar proveedor.</div>`;
        return;
      }

      const providers = loadProviders();

      pending.forEach(item=>{
        try{
          const type = item.movementLabel || (item.movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor");
          const amount = Number(item.amount || 0);
          const currency = item.currency || "";
          const rate = Number(item.providerRate || 0);
          const usdt = rate > 0 ? amount / rate : 0;
          const opNumber = item.operationNumber || "Sin número";
          const route = `${item.originCountry || "—"} → ${item.destCountry || "—"}`;
          const country = item.country || "";
          const pendingDateText = formatPendingDateTime(item.createdAt || item.date || "");

          let operatorText = "";
          if(typeof getProviderMovementOperatorName === "function"){
            operatorText = getProviderMovementOperatorName(item);
          }

          if(!operatorText || operatorText === "No disponible"){
            try{
              const ops = typeof loadOperations === "function" ? loadOperations() : [];
              const foundOp = ops.find(op =>
                String(op.id || "") === String(item.operationId || "") ||
                (
                  String(op.operationNumber || "") &&
                  String(op.operationNumber || "") === String(item.operationNumber || "")
                )
              );

              if(foundOp && typeof getOperatorDisplayName === "function"){
                operatorText = getOperatorDisplayName(foundOp);
              }

              if((!operatorText || operatorText === "No disponible") && foundOp){
                operatorText =
                  foundOp.operatorName ||
                  foundOp.createdByName ||
                  foundOp.registeredByName ||
                  foundOp.createdByFullName ||
                  foundOp.registeredByFullName ||
                  foundOp.fullName ||
                  foundOp.profileFullName ||
                  foundOp.displayName ||
                  foundOp.userName ||
                  foundOp.operatorEmail ||
                  foundOp.createdByEmail ||
                  foundOp.registeredByEmail ||
                  foundOp.email ||
                  "";
              }
            }catch(e){}
          }

          if(!operatorText || operatorText === "No disponible"){
            try{
              if(typeof loadProfile === "function"){
                const profile = loadProfile();
                operatorText =
                  profile.fullName ||
                  profile.profileFullName ||
                  profile.displayName ||
                  profile.name ||
                  profile.userName ||
                  profile.email ||
                  "";
              }
            }catch(e){}
          }

          operatorText = operatorText || "No disponible";

          const noDecimals = ["CLP","COP","PYG"].includes(String(currency || "").toUpperCase());
          const amountText = Number(amount || 0).toLocaleString("es-CL", {
            minimumFractionDigits: noDecimals ? 0 : 2,
            maximumFractionDigits: noDecimals ? 0 : 2
          }) + (currency ? ` ${currency}` : "");

          const countryProviders = providers.filter(provider =>
            String(provider.country || "").trim().toLowerCase() === String(country || "").trim().toLowerCase()
          );

          const providerOptions = countryProviders.map(provider=>{
            const status = (provider.status || "active") === "active" ? "Activo" : "Inactivo";
            return `<option value="${provider.id}">${provider.name} · ${status}</option>`;
          }).join("");

          const card = document.createElement("div");
          card.className = "dash-card";
          card.style.minHeight = "auto";
          card.style.marginTop = "12px";

          card.innerHTML = `
            <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start;">
              <div>
                <div class="dash-label">${country || "País sin definir"} · ${type}</div>
                <div class="dash-value" style="font-size:22px;">Operación ${opNumber}</div>

                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;">
                  <div class="modal-summary">
                    <div class="dash-label">Fecha</div>
                    <div class="dash-sub"><strong>${pendingDateText}</strong></div>
                  </div>

                  <div class="modal-summary">
                    <div class="dash-label">Ruta</div>
                    <div class="dash-sub"><strong>${route}</strong></div>
                  </div>

                  <div class="modal-summary">
                    <div class="dash-label">Monto</div>
                    <div class="dash-sub"><strong>${amountText}</strong></div>
                  </div>

                  <div class="modal-summary">
                    <div class="dash-label">Tasa tomada</div>
                    <div class="dash-sub"><strong>${rate > 0 ? rate : "Sin tasa"}</strong></div>
                  </div>

                  <div class="modal-summary">
                    <div class="dash-label">Equivalente estimado</div>
                    <div class="dash-sub"><strong>${rate > 0 ? usdt.toFixed(2) + " USDT" : "—"}</strong></div>
                  </div>

                  <div class="modal-summary">
                    <div class="dash-label">Registrado por</div>
                    <div class="dash-sub"><strong>${operatorText}</strong></div>
                  </div>
                </div>
              </div>

              <div style="display:grid;gap:10px;">
                <label class="field">
                  <span>Asignar proveedor</span>
                  <select class="input" id="pendingProviderSelect_${item.id}">
                    <option value="">Selecciona proveedor...</option>
                    ${providerOptions}
                  </select>
                </label>

                <button class="btn small" type="button" onclick="assignPendingProviderMovement('${item.id}')">Asignar proveedor</button>

                <div class="dash-sub">
                  ${countryProviders.length ? `${countryProviders.length} proveedores disponibles para ${country}` : `No hay proveedores creados para ${country}`}
                </div>
              </div>
            </div>
          `;

          providerPendingFullList.appendChild(card);
        }catch(error){
          console.error("ERROR_RENDER_PENDING_PROVIDER_CARD", error, item);
        }
      });
    }

    window.openProviderPendingMovements = function(){
      if(!providerPendingPanel || !providerPendingList) return;

      const pending = loadProviderMovements()
        .filter(item => (item.status || "pending") === "pending")
        .sort((a,b)=> new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

      providerPendingList.innerHTML = "";

      if(!pending.length){
        providerPendingPanel.style.display = "block";
        providerPendingList.innerHTML = `<div class="empty-state">No hay movimientos pendientes por asignar proveedor.</div>`;
        return;
      }

      const providers = loadProviders();

      pending.forEach(item=>{
        const type = item.movementLabel || (item.movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor");
        const amount = Number(item.amount || 0);
        const currency = item.currency || "";
        const opNumber = item.operationNumber || "Sin número";
        const route = `${item.originCountry || "—"} → ${item.destCountry || "—"}`;
        const country = item.country || "";

        const countryProviders = providers.filter(provider =>
          String(provider.country || "").trim().toLowerCase() === String(country || "").trim().toLowerCase()
        );

        const providerOptions = countryProviders.map(provider=>{
          const status = (provider.status || "active") === "active" ? "Activo" : "Inactivo";
          return `<option value="${provider.id}">${provider.name} · ${status}</option>`;
        }).join("");

        const card = document.createElement("div");
        card.className = "dash-card";
        card.style.minHeight = "auto";

        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <div class="dash-label">${country || "País sin definir"}</div>
              <div class="dash-value" style="font-size:20px;">${opNumber}</div>
              <div class="dash-sub">${route}</div>
              <div class="dash-sub" style="margin-top:6px;">${type}</div>
              <div class="dash-sub" style="margin-top:6px;"><strong>${amount.toLocaleString("es-CL")} ${currency}</strong></div>
            </div>

            <div style="min-width:240px;display:grid;gap:8px;">
              <select class="input" id="pendingProviderSelect_${item.id}">
                <option value="">Selecciona proveedor...</option>
                ${providerOptions}
              </select>
              <button class="btn small" type="button" onclick="assignPendingProviderMovement('${item.id}')">Asignar proveedor</button>
            </div>
          </div>
        `;

        providerPendingList.appendChild(card);
      });

      providerPendingPanel.style.display = "block";
    };

    window.assignPendingProviderMovement = function(movementId){
      const select = document.getElementById(`pendingProviderSelect_${movementId}`);
      const providerId = select ? select.value : "";

      if(!providerId){
        onzeAlert("Debes seleccionar un proveedor.");
        return;
      }

      const providers = loadProviders();
      const provider = providers.find(p => String(p.id) === String(providerId));

      if(!provider){
        onzeAlert("No encontré el proveedor seleccionado.");
        return;
      }

      const movements = loadProviderMovements();
      const movement = movements.find(item => String(item.id) === String(movementId));

      if(!movement){
        onzeAlert("No encontré el movimiento pendiente.");
        return;
      }

      movement.providerId = provider.id;
      movement.providerName = provider.name || "";
      movement.status = "assigned";
      movement.assignedAt = new Date().toISOString();

      saveProviderMovements(movements);
      renderProvidersView();
      renderProviderPendingFullView();

      if(typeof showToast === "function"){
        showToast("Movimiento asignado correctamente");
      }
    };

    window.openProviderControlDetail = function(id){
      const providers = loadProviders();
      const provider = providers.find(p => String(p.id) === String(id));

      if(!provider){
        onzeAlert("No encontré este proveedor.");
        return;
      }

    function formatProviderMoney(value, currency){
      const cur = String(currency || "").trim().toUpperCase();
      const n = Number(value || 0);
      const noDecimals = ["CLP", "COP", "PYG"].includes(cur);

      return n.toLocaleString("es-CL", {
        minimumFractionDigits: noDecimals ? 0 : 2,
        maximumFractionDigits: noDecimals ? 0 : 2
      }) + (cur ? ` ${cur}` : "");
    }


    function getProviderMovementOperatorName(item){
      function clean(v){
        return String(v || "").trim();
      }

      function pickName(obj){
        if(!obj) return "";

        const first = clean(obj.firstName || obj.nombre || obj.name);
        const last = clean(obj.lastName || obj.apellido || obj.lastname);
        const fullFromParts = [first, last].filter(Boolean).join(" ").trim();

        return clean(
          obj.operatorName ||
          obj.registeredByName ||
          obj.createdByName ||
          obj.createdByFullName ||
          obj.registeredByFullName ||
          obj.fullName ||
          obj.profileFullName ||
          obj.displayName ||
          obj.userName ||
          fullFromParts ||
          obj.operatorEmail ||
          obj.createdByEmail ||
          obj.registeredByEmail ||
          obj.email ||
          obj.createdBy ||
          obj.registeredBy ||
          ""
        );
      }

      const direct = pickName(item);
      if(direct && direct.toLowerCase() !== "no disponible") return direct;

      const ops = typeof loadOperations === "function" ? loadOperations() : [];
      const found = ops.find(op =>
        String(op.id || "") === String(item.operationId || "") ||
        (
          String(op.operationNumber || "") &&
          String(op.operationNumber || "") === String(item.operationNumber || "")
        )
      );

      const opName = pickName(found);
      if(opName && opName.toLowerCase() !== "no disponible") return opName;

      const possibleIds = [
        item.operatorId,
        item.userId,
        item.createdById,
        item.registeredById,
        item.createdBy,
        item.registeredBy,
        item.operatorEmail,
        item.createdByEmail,
        item.registeredByEmail,
        found?.operatorId,
        found?.userId,
        found?.createdById,
        found?.registeredById,
        found?.createdBy,
        found?.registeredBy,
        found?.operatorEmail,
        found?.createdByEmail,
        found?.registeredByEmail
      ].map(clean).filter(Boolean);

      if(possibleIds.length){
        try{
          for(let i = 0; i < localStorage.length; i++){
            const key = localStorage.key(i);
            const raw = localStorage.getItem(key);
            if(!raw) continue;

            const trimmed = raw.trim();
            if(!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;

            let parsed;
            try{ parsed = JSON.parse(raw); }catch(e){ continue; }

            const list = Array.isArray(parsed) ? parsed : [parsed];

            for(const user of list){
              if(!user || typeof user !== "object") continue;

              const values = [
                user.id,
                user._id,
                user.userId,
                user.uid,
                user.email,
                user.operatorEmail,
                user.createdBy,
                user.registeredBy
              ].map(clean).filter(Boolean);

              const match = possibleIds.some(id => values.includes(id));
              if(match){
                const userName = pickName(user);
                if(userName && userName.toLowerCase() !== "no disponible") return userName;
              }
            }
          }
        }catch(e){}
      }

      try{
        if(typeof loadProfile === "function"){
          const profile = loadProfile();
          const profileName = pickName(profile);
          if(profileName && profileName.toLowerCase() !== "no disponible") return profileName;
        }

        const profileKeys = [
          "onzeProfile",
          "profile",
          "userProfile",
          "onze_user_profile",
          "onze_current_user",
          "currentUser"
        ];

        for(const key of profileKeys){
          const raw = localStorage.getItem(key);
          if(!raw) continue;

          let parsed;
          try{ parsed = JSON.parse(raw); }catch(e){ continue; }

          const profileName = pickName(parsed);
          if(profileName && profileName.toLowerCase() !== "no disponible") return profileName;
        }
      }catch(e){}

      return "No disponible";
    }

    function formatProviderDateTime(value){
      if(!value) return "Sin fecha";

      const raw = String(value).trim();

      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
        const [y,m,d] = raw.split("-");
        return `${d}/${m}/${y}`;
      }

      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if(isoMatch){
        const [, y, m, d, hh, mm] = isoMatch;
        return `${d}/${m}/${y} ${hh}:${mm}`;
      }

      const date = new Date(raw);
      if(Number.isNaN(date.getTime())) return raw;

      return date.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    }

    function formatProviderDateTimeClean(value){
      if(!value) return "Sin fecha";

      const raw = String(value).trim();

      // YYYY-MM-DD
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
        const [y,m,d] = raw.split("-");
        return `${d}/${m}/${y}`;
      }

      // YYYY-MM-DDTHH:mm:ss.000Z
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if(iso){
        const [, y, m, d, hh, mm] = iso;
        return `${d}/${m}/${y} ${hh}:${mm}`;
      }

      const parsed = new Date(raw);
      if(Number.isNaN(parsed.getTime())) return raw;

      const dd = String(parsed.getDate()).padStart(2, "0");
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const yy = parsed.getFullYear();
      const hh = String(parsed.getHours()).padStart(2, "0");
      const mi = String(parsed.getMinutes()).padStart(2, "0");

      return `${dd}/${mm}/${yy} ${hh}:${mi}`;
    }

    function formatProviderDate(value){
      if(!value) return "Sin fecha";
      const raw = String(value).trim();

      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
        const [y,m,d] = raw.split("-");
        return `${d}/${m}/${y}`;
      }

      const date = new Date(raw);
      if(Number.isNaN(date.getTime())) return raw;

      return date.toLocaleDateString("es-CL");
    }

    function getProviderMovementStyles(movementType){
      const isReceived = movementType === "received";

      return {
        badgeBg: isReceived ? "rgba(34,197,94,.14)" : "rgba(239,68,68,.14)",
        badgeColor: isReceived ? "#86efac" : "#fca5a5",
        badgeBorder: isReceived ? "rgba(34,197,94,.28)" : "rgba(239,68,68,.28)",
        cardBg: isReceived ? "linear-gradient(135deg, rgba(34,197,94,.11), rgba(15,23,42,.94))" : "linear-gradient(135deg, rgba(239,68,68,.11), rgba(15,23,42,.94))",
        cardBorder: isReceived ? "rgba(34,197,94,.24)" : "rgba(239,68,68,.24)"
      };
    }

      currentProviderDetailId = id;

      const movements = loadProviderMovements()
        .filter(item => String(item.providerId || "") === String(id))
        .sort((a,b)=> new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

      openProviderControlScreen();
      if(providerDetailTitle) providerDetailTitle.textContent = `Control proveedor: ${provider.name}`;
      if(providerDetailSubtitle) providerDetailSubtitle.textContent = `${provider.country || "—"} · ${provider.currency || "—"} · Movimientos asignados`;

      if(!providerDetailList) return;

      providerDetailList.innerHTML = "";

      if(!movements.length){
        if(providerReceivedTotal) providerReceivedTotal.textContent = "0";
        if(providerReceivedCount) providerReceivedCount.textContent = "0 movimientos";
        if(providerPaidTotal) providerPaidTotal.textContent = "0";
        if(providerPaidCount) providerPaidCount.textContent = "0 movimientos";
        if(providerFinalResult) providerFinalResult.textContent = "Sin movimientos";

        currentProviderSummaryText = `CIERRE PROVEEDOR - ${provider.name}\nPaís: ${provider.country || "—"}\n\nSin movimientos asignados.`;

        providerDetailList.innerHTML = `<div class="empty-state">Aún no hay movimientos asignados a este proveedor.</div>`;
        return;
      }

      const received = movements.filter(item => item.movementType === "received");
      const paid = movements.filter(item => item.movementType === "paid");

      const totalReceived = received.reduce((sum,item)=>sum + Number(item.amount || 0), 0);
      const totalPaid = paid.reduce((sum,item)=>sum + Number(item.amount || 0), 0);
      const currency = provider.currency || movements[0]?.currency || "";

      const totalReceivedUsdt = received.reduce((sum,item)=>{
        const rate = Number(item.providerRate || 0);
        return sum + (rate > 0 ? Number(item.amount || 0) / rate : 0);
      }, 0);

      const totalPaidUsdt = paid.reduce((sum,item)=>{
        const rate = Number(item.providerRate || 0);
        return sum + (rate > 0 ? Number(item.amount || 0) / rate : 0);
      }, 0);

      const diffUsdt = totalReceivedUsdt - totalPaidUsdt;

      let resultText = "Saldo cero";
      if(Math.abs(diffUsdt) >= 0.01){
        resultText = diffUsdt > 0
          ? `${provider.name} paga a ONZE: ${diffUsdt.toFixed(2)} USDT`
          : `ONZE paga a ${provider.name}: ${Math.abs(diffUsdt).toFixed(2)} USDT`;
      }

      if(providerReceivedTotal) providerReceivedTotal.textContent = formatProviderMoney(totalReceived, currency);
      if(providerReceivedCount) providerReceivedCount.textContent = `${received.length} movimientos`;
      if(providerPaidTotal) providerPaidTotal.textContent = formatProviderMoney(totalPaid, currency);
      if(providerPaidCount) providerPaidCount.textContent = `${paid.length} movimientos`;
      if(providerFinalResult) providerFinalResult.textContent = resultText;

      const movementSummaryLines = movements.map((item, index)=>{
        const type = item.movementLabel || (item.movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor");
        const amount = Number(item.amount || 0);
        const itemCurrency = item.currency || currency || "";
        const rate = Number(item.providerRate || 0);
        const usdt = rate > 0 ? amount / rate : 0;

        return [
          `${index + 1})`,
          `Tipo: ${type}`,
          `Monto: ${formatProviderMoney(amount, itemCurrency)}`,
          rate > 0 ? `Tasa: ${rate}` : `Tasa: No disponible`,
          rate > 0 ? `Equivalente: ${usdt.toFixed(2)} USDT` : `Equivalente: No disponible`
        ].join("\n");
      });

      const summaryLines = [
        `CIERRE PROVEEDOR - ${String(provider.name || "").toUpperCase()}`,
        `País: ${provider.country || "—"}`,
        `Fecha: ${new Date().toLocaleDateString("es-CL")}`,
        "",
        `RECIBIDO POR ${String(provider.name || "PROVEEDOR").toUpperCase()}`,
        `Movimientos: ${received.length}`,
        `Total: ${formatProviderMoney(totalReceived, currency)}`,
        `Total estimado USDT: ${totalReceivedUsdt.toFixed(2)} USDT`,
        "",
        `PAGADO POR ${String(provider.name || "PROVEEDOR").toUpperCase()}`,
        `Movimientos: ${paid.length}`,
        `Total: ${formatProviderMoney(totalPaid, currency)}`,
        `Total estimado USDT: ${totalPaidUsdt.toFixed(2)} USDT`,
        "",
        `RESULTADO FINAL`,
        resultText
      ];

      currentProviderSummaryText = summaryLines.join("\n");

      const detailLines = movements.map((item, index)=>{
        const type = item.movementLabel || (item.movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor");
        const amount = Number(item.amount || 0);
        const itemCurrency = item.currency || currency || "";
        const rate = Number(item.providerRate || 0);
        const usdt = rate > 0 ? amount / rate : 0;

        return [
          `${index + 1})`,
          `Tipo: ${type}`,
          `Monto: ${formatProviderMoney(amount, itemCurrency)}`,
          rate > 0 ? `Tasa: ${rate}` : `Tasa: No disponible`,
          rate > 0 ? `Equivalente: ${usdt.toFixed(2)} USDT` : `Equivalente: No disponible`
        ].join("\n");
      });

      currentProviderDetailText = [
        `DETALLE PROVEEDOR - ${String(provider.name || "").toUpperCase()}`,
        `País: ${provider.country || "—"}`,
        `Fecha: ${new Date().toLocaleDateString("es-CL")}`,
        "",
        `MOVIMIENTOS DETALLADOS`,
        ...detailLines
      ].join("\n\n");

      movements.forEach(item=>{
        const type = item.movementLabel || (item.movementType === "received" ? "Recibido por proveedor" : "Pagado por proveedor");
        const amount = Number(item.amount || 0);
        const itemCurrency = item.currency || currency || "";
        const opNumber = item.operationNumber || "Sin número";
        const route = `${item.originCountry || "—"} → ${item.destCountry || "—"}`;
        const rate = Number(item.providerRate || 0);
        const usdt = rate > 0 ? amount / rate : 0;
        const cleanDate = formatProviderDate(item.date || item.createdAt || "");
        const styles = getProviderMovementStyles(item.movementType);
        const operatorName = getProviderMovementOperatorName(item);

        if(operatorName && operatorName !== "No disponible" && !item.operatorName){
          item.operatorName = operatorName;
          try{
            const allMovements = loadProviderMovements();
            const idx = allMovements.findIndex(m => String(m.id || "") === String(item.id || ""));
            if(idx >= 0){
              allMovements[idx].operatorName = operatorName;
              saveProviderMovements(allMovements);
            }
          }catch(e){}
        }

        const card = document.createElement("div");
        card.className = "dash-card";
        card.style.minHeight = "auto";
        card.style.background = styles.cardBg;
        card.style.borderColor = styles.cardBorder;

        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <div style="display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:${styles.badgeBg};color:${styles.badgeColor};border:1px solid ${styles.badgeBorder};font-size:12px;font-weight:800;margin-bottom:8px;">
                ${type}
              </div>
              <div class="dash-value" style="font-size:20px;">Operación ${opNumber}</div>
              <div class="dash-sub">${cleanDate} · ${route}</div>
              <div class="dash-sub" style="margin-top:6px;">
                Registrado por: <strong style="color:#e5e7eb;">${operatorName}</strong>
              </div>
            </div>
            <div style="text-align:right;">
              <div class="dash-value" style="font-size:20px;">${formatProviderMoney(amount, itemCurrency)}</div>
              <div class="dash-sub">${rate > 0 ? `${usdt.toFixed(2)} USDT · tasa ${rate}` : "Sin tasa USDT"}</div>
            </div>
          </div>
        `;

        providerDetailList.appendChild(card);
      });
    };

    window.openEditProviderModal = function(id){
      const providers = loadProviders();
      const provider = providers.find(p => p.id === id);

      if(!provider) return;

      editingProviderId = id;

      if(providerModalTitle) providerModalTitle.textContent = "Editar proveedor";
      if(providerNameInput) providerNameInput.value = provider.name || "";
      if(providerCountryInput) providerCountryInput.value = provider.country || "";
      if(providerCurrencyInput) providerCurrencyInput.value = provider.currency || "";
      if(providerNoteInput) providerNoteInput.value = provider.note || "";
      if(saveProviderBtn) saveProviderBtn.textContent = "Guardar cambios";

      if(providerModal){
        providerModal.classList.add("open");
        providerModal.setAttribute("aria-hidden", "false");
      }
    };

    window.toggleProviderStatus = function(id){
      const providers = loadProviders();
      const provider = providers.find(p => p.id === id);

      if(!provider) return;

      provider.status = (provider.status || "active") === "active" ? "inactive" : "active";
      provider.updatedAt = new Date().toISOString();

      saveProviders(providers);
      renderProvidersView();

      if(typeof showToast === "function"){
        showToast(provider.status === "active" ? "Proveedor activado" : "Proveedor desactivado");
      }
    };

    function renderOperatorProfit(ops = loadOperations()){
  if(!operatorProfitBody || !operatorProfitEmpty) return;

  populateOperatorProfitFilter(ops);

  const filteredOps = getOperatorProfitFilteredOps(ops);
  const groups = aggregateOperatorProfit(filteredOps);

  operatorProfitBody.innerHTML = "";

  if(operatorSelectedName){
    operatorSelectedName.textContent = operatorProfitFilter?.value || "Selecciona";
  }

  const totalUsdt = filteredOps.reduce((sum, op) => sum + getOperatorPayUsdt(op), 0);

  if(operatorProfitTotal){
    operatorProfitTotal.textContent = formatCalcValue(totalUsdt, "USDT");
  }

  if(operatorProfitTotalCur){
    operatorProfitTotalCur.textContent = "USDT";
  }

  if(operatorProfitPending){
    operatorProfitPending.textContent = "0";
  }

  if(operatorProfitPendingCur){
    operatorProfitPendingCur.textContent = "—";
  }

  const operatorProfitPendingCard = operatorProfitPending?.closest(".dash-card");
  if(operatorProfitPendingCard){
    operatorProfitPendingCard.style.display = "none";
  }

  const operatorCardsGrid = operatorSelectedName?.closest(".dash-card")?.parentElement;
  if(operatorCardsGrid){
    operatorCardsGrid.style.gridTemplateColumns = "repeat(2,minmax(0,1fr))";
  }

  if(!groups.length){
    operatorProfitEmpty.style.display = "block";
    operatorProfitEmpty.textContent = operatorProfitFilter?.value
      ? "Todavía no hay datos para este operador."
      : "Selecciona un operador para ver su detalle.";

    if(operatorProfitCountryGrid) operatorProfitCountryGrid.innerHTML = "";
    if(operatorProfitCountryEmpty){
      operatorProfitCountryEmpty.style.display = "block";
      operatorProfitCountryEmpty.textContent = operatorProfitFilter?.value
        ? "Todavía no hay ganancias por país para este operador."
        : "Selecciona un operador para ver su resumen por país.";
    }
    return;
  }

  operatorProfitEmpty.style.display = "none";

  groups.forEach(group=>{
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${group.name}</td>
      <td>${group.modeLabel}</td>
      <td>${formatCalcValue(Number(group.total || 0), group.currency)}</td>
      <td>${group.currency}</td>
    `;

    operatorProfitBody.appendChild(tr);
  });

  const countryGroups = aggregateOperatorProfitByCountry(filteredOps);

  if(operatorProfitCountryGrid){
    if(countryGroups.length){
      operatorProfitCountryGrid.innerHTML = countryGroups.map(group => `
        <div class="country-profit-item" style="padding:18px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(67,124,255,.22);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-size:13px;letter-spacing:.4px;text-transform:uppercase;color:#9fb4d4;font-weight:800;">
                ${getFlagEmoji(group.country)} ${group.country}
              </div>
              <div style="margin-top:10px;font-size:30px;font-weight:900;line-height:1;color:#fff;">
                ${formatCalcValue(Number(group.total || 0), group.currency)}
              </div>
              <div style="margin-top:6px;font-size:13px;color:#8ea7cf;font-weight:700;">
                ${group.currency}
              </div>
            </div>
          </div>
        </div>
      `).join("");
    }else{
      operatorProfitCountryGrid.innerHTML = "";
    }
  }

  if(operatorProfitCountryEmpty){
    operatorProfitCountryEmpty.style.display = countryGroups.length ? "none" : "block";
    operatorProfitCountryEmpty.textContent = "Todavía no hay ganancias por país para este operador.";
  }
}


function refreshHistoryUI(){
      const ops = loadOperations().sort((a,b)=>new Date(b.createdAt) - new Date(a.createdAt));
      const activeOps = ops.filter(op => !op.deleted);
      historyBody.innerHTML = "";

      const historyThead = document.querySelector('#view-historial thead');

      if(historyThead){
        historyThead.innerHTML = IS_ADMIN_ROLE
          ? `
                <tr>
                  <th>Fecha</th>
                  <th>Operador</th>
                  <th>Cliente</th>
                  <th>N° Operación</th>
                  <th>Tipo</th>
                  <th>Ruta</th>
                  <th>Envía</th>
                  <th>Recibe</th>
                  <th>Tasa proveedor</th>
                  <th>Tu tasa</th>
                  <th>Ganancia operador</th>
                  <th>Ganancia ONZE</th>
                  <th>Observación</th>
                  <th>Acción</th>
                </tr>
              `
          : `
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>N° Operación</th>
                  <th>Tipo</th>
                  <th>Ruta</th>
                  <th>Envía</th>
                  <th>Recibe</th>
                  <th>Tasa proveedor</th>
                  <th>Tu tasa</th>
                  <th>Ganancia</th>
                  <th>Observación</th>
                  <th>Acción</th>
                </tr>
              `;
      }

      if(!ops.length){
        historyEmpty.style.display = "block";
      }else{
        historyEmpty.style.display = "none";
      }

      ops.forEach(op=>{
        const isDeleted = !!op.deleted;
        const tr = document.createElement("tr");

        if(isDeleted){
          tr.style.opacity = "0.45";
        }

        const operatorName = getOperatorDisplayName(op) || "—";
        const isManualOnze = String(op?.operatorMode || "").trim().toLowerCase() === "manual";

        const operatorProfitHtml = isManualOnze
          ? `<span style="opacity:.55;">—</span>`
          : (
              op.operatorMode === "socio" && Number(op.partnerPayoutDestCostUsdt || 0) > 0
                ? `<div><span class="${IS_ADMIN_ROLE ? "" : "pill green"}" style="${IS_ADMIN_ROLE ? "display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;line-height:1;background:rgba(148,163,184,.16);color:#dbeafe;border:1px solid rgba(148,163,184,.20);box-shadow:none;" : ""}">${op.profitDisplay}</span></div>
                   <div style="font-size:12px; opacity:.78; margin-top:4px;">Costo destino: ${formatCalcValue(op.partnerPayoutDestCostUsdt || 0, "USDT")} USDT</div>
                   <div style="font-size:12px; font-weight:700; margin-top:2px;">Total a pagar: ${formatCalcValue(op.partnerPayoutTotalUsdt || 0, "USDT")} USDT</div>`
                : `<div><span class="${IS_ADMIN_ROLE ? "" : "pill green"}" style="${IS_ADMIN_ROLE ? "display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;line-height:1;background:rgba(148,163,184,.16);color:#dbeafe;border:1px solid rgba(148,163,184,.20);box-shadow:none;" : ""}">${op.profitDisplay}</span></div>`
            );

        let onzeProfitHtml = `<span class="pill" style="background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(148,163,184,.22);">—</span>`;

        if(!isDeleted){
          const rawUsdt = Number(op?.onzeProfitUsdt || 0);
          const roundedUsdt = Math.round(rawUsdt * 10) / 10;
          const buyRate = Number(op?.buyOriginValue || 0);
          const originCurrency = String(op?.originCurrency || op?.onzeProfitOriginCurrencyCode || "").trim().toUpperCase();

          let visualOriginAmount = Number.isFinite(buyRate) && buyRate > 0
            ? roundedUsdt * buyRate
            : Number(op?.onzeProfitOriginAmount || 0);

          if(originCurrency === "CLP"){
            visualOriginAmount = Math.round(visualOriginAmount);
          }

          if(Number.isFinite(rawUsdt) && rawUsdt !== 0){
            onzeProfitHtml = `
              <div><span class="pill green">${formatCalcValue(visualOriginAmount, originCurrency)} ${originCurrency || ""}</span></div>
              <div style="margin-top:6px;"><span class="pill blue">${formatCalcValue(roundedUsdt, "USDT")} USDT</span></div>
            `;
          }
        }

        if(IS_ADMIN_ROLE){
          tr.innerHTML = `
            <td>${formatDateTimeForTable(op.date, op.createdAt)}</td>
            <td>${operatorName}</td>
            <td>${op.clientName || "—"}</td>
            <td>${op.operationNumber || "—"}</td>
            <td>${isDeleted ? `<span class="pill danger">Eliminada</span>` : `<span class="pill blue">${op.operationType}</span>`}</td>
            <td>${op.originCountry} → ${op.destCountry}</td>
            <td>${op.sendAmountFormatted}</td>
            <td>${op.receiveAmountFormatted}</td>
            <td>${op.providerRateFormatted}</td>
            <td>${op.clientRateFormatted}</td>
            <td>${isDeleted ? `<span class="pill" style="background:rgba(239,68,68,.12);color:#fecaca;border:1px solid rgba(239,68,68,.25);">No contabiliza</span>` : operatorProfitHtml}</td>
            <td>${isDeleted ? `<span class="pill" style="background:rgba(239,68,68,.12);color:#fecaca;border:1px solid rgba(239,68,68,.25);">No contabiliza</span>` : onzeProfitHtml}</td>
            <td>${op.note || "—"}</td>
            <td>${isDeleted ? `<span style="font-size:12px;opacity:.85;">Anulada</span>` : `<button class="btn small danger" type="button" onclick="deleteOperation('${op.id}')">🗑️</button>`}</td>
          `;
        }else{
          tr.innerHTML = `
            <td>${formatDateTimeForTable(op.date, op.createdAt)}</td>
            <td>${op.clientName || "—"}</td>
            <td>${op.operationNumber || "—"}</td>
            <td>${isDeleted ? `<span class="pill danger">Eliminada</span>` : `<span class="pill blue">${op.operationType}</span>`}</td>
            <td>${op.originCountry} → ${op.destCountry}</td>
            <td>${op.sendAmountFormatted}</td>
            <td>${op.receiveAmountFormatted}</td>
            <td>${op.providerRateFormatted}</td>
            <td>${op.clientRateFormatted}</td>
            <td>${isDeleted ? `<span class="pill" style="background:rgba(239,68,68,.12);color:#fecaca;border:1px solid rgba(239,68,68,.25);">No contabiliza</span>` : operatorProfitHtml}</td>
            <td>${op.note || "—"}</td>
            <td>${isDeleted ? `<span style="font-size:12px;opacity:.85;">Anulada</span>` : `<button class="btn small danger" type="button" onclick="deleteOperation('${op.id}')">🗑️</button>`}</td>
          `;
        }

        if(isDeleted){
          Array.from(tr.children).forEach(td => {
            td.style.textDecoration = "line-through";
            td.style.textDecorationThickness = "2px";
            td.style.textDecorationColor = "rgba(255,255,255,.75)";
          });
        }

        historyBody.appendChild(tr);
      });

      refreshDashboard(activeOps);
      renderCountryProfit(activeOps);
      renderOperatorProfit(activeOps);
      renderInitialCapital();
    }

    function refreshDashboard(ops = loadOperations()){
      const activeOps = (Array.isArray(ops) ? ops : []).filter(op => !op?.deleted);

      const now = new Date();
      const today = todayISO();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

      const todayOps = activeOps.filter(op => (op.date || "").startsWith(today));
      const monthOps = activeOps.filter(op => (op.date || "").startsWith(currentMonth));

      dashOpsToday.textContent = String(todayOps.length);
      dashOpsMonth.textContent = String(monthOps.length);

      const groupProfit = (items)=>{
        const totals = new Map();
        items.forEach(op=>{
          const meta = getDashboardProfitMeta(op);
          const key = meta.currency || "MON";
          const prev = totals.get(key) || 0;
          totals.set(key, prev + Number(meta.amount || 0));
        });
        if(!totals.size) return {amount:"0", currency:"—"};
        const [currency, value] = Array.from(totals.entries()).sort((a,b)=>Math.abs(b[1]) - Math.abs(a[1]))[0];
        return {
          amount: formatCalcValue(value, currency),
          currency: currency
        };
      };

      const todayProfit = IS_ADMIN_ROLE ? groupProfit(todayOps) : groupProfit(monthOps);
      const monthProfit = groupProfit(monthOps);

      const sumUsdt = (items, field) => items.reduce((sum, op) => sum + Number(op?.[field] || 0), 0);
      const todayCollectedUsdt = sumUsdt(todayOps, "amountCollectedUsdt");
      const todayPendingUsdt = sumUsdt(todayOps, "amountPendingUsdt");
      const monthCollectedUsdt = sumUsdt(monthOps, "amountCollectedUsdt");
      const monthPendingUsdt = sumUsdt(monthOps, "amountPendingUsdt");

      const balanceSummary = getBalanceSummaryByCountry();

      const initialCapitalUsdt = loadInitialCapital().reduce((sum, item) => {
        const amount = Number(item?.amount || 0);
        const country = String(item?.country || "").trim();
        const currency = String(item?.currency || item?.currencyCode || "").trim().toUpperCase();
        const converted = currency === "USDT"
          ? amount
          : Number(toUsdtFromCountryAmount(country, amount) || 0);
        return sum + converted;
      }, 0);

      const onzeProfitTotalUsdt = activeOps.reduce((sum, op) => {
        const rawUsdt = Number(op?.onzeProfitUsdt || 0);
        const roundedUsdt = Math.round(rawUsdt * 10) / 10;
        return sum + roundedUsdt;
      }, 0);

      const monthExpensesUsdt = loadExpenses()
        .filter(exp => String(exp?.date || "").startsWith(currentMonth))
        .reduce((sum, exp) => {
          const amount = Number(exp?.amount || exp?.amountUsdt || 0);
          const country = String(exp?.country || exp?.currency || "USDT");
          const converted = country === "USDT" ? amount : Number(toUsdtFromCountryAmount(country, amount) || 0);
          return sum + converted;
        }, 0);

      const capitalTotalUsdt = initialCapitalUsdt + onzeProfitTotalUsdt;
      const netBalanceUsdt = capitalTotalUsdt - monthExpensesUsdt;

      const receivablesOps = monthOps.filter(op => ["pending", "partial"].includes(String(op?.paymentStatus || "")));
      const receivablesCount = receivablesOps.length;
      const receivablesUsdt = receivablesOps.reduce((sum, op) => sum + Number(op?.amountPendingUsdt || 0), 0);

      const countriesCount = balanceSummary.filter(item => Number(item?.saldoActual || 0) !== 0).length;
      const countriesTotalUsdt = capitalTotalUsdt;

      dashProfitToday.textContent = todayProfit.amount;
      dashProfitTodayCur.textContent = todayProfit.currency;
      dashProfitMonth.textContent = monthProfit.amount;
      dashProfitMonthCur.textContent = monthProfit.currency;

      if(dashUsdtCollected) dashUsdtCollected.textContent = `${formatCalcValue(monthCollectedUsdt, "USDT")}`;
      if(dashUsdtPending) dashUsdtPending.textContent = `${formatCalcValue(monthPendingUsdt, "USDT")}`;
      if(dashUsdtCapital) dashUsdtCapital.textContent = `${formatCalcValue(capitalTotalUsdt, "USDT")}`;
      if(dashMonthExpenses) dashMonthExpenses.textContent = `${formatCalcValue(monthExpensesUsdt, "USDT")}`;
      if(dashNetBalance) dashNetBalance.textContent = `${formatCalcValue(netBalanceUsdt, "USDT")}`;
      if(dashReceivablesCount) dashReceivablesCount.textContent = String(receivablesCount);
      if(dashReceivablesUsdt) dashReceivablesUsdt.textContent = `${formatCalcValue(receivablesUsdt, "USDT")} USDT`;
      if(dashCountriesTotal) dashCountriesTotal.textContent = String(countriesCount);
      if(dashCountriesTotalUsdt) dashCountriesTotalUsdt.textContent = `${formatCalcValue(countriesTotalUsdt, "USDT")} USDT`;
    }

    function openRegisterModal(data){
  const normalizedOperatorMode = String(
    data?.operatorMode ||
    ((isGlobalAdmin() || isTenantAdmin()) ? getActiveCalculatorMode() : CURRENT_USER_CONTEXT?.operatorMode) ||
    ""
  ).trim().toLowerCase();

  const mappedOperatorMode = normalizedOperatorMode === "onze"
    ? "manual"
    : normalizedOperatorMode;

  const modalData = {
    ...data,
    operatorMode: ["libre", "porcentaje", "socio", "manual"].includes(mappedOperatorMode)
      ? mappedOperatorMode
      : "manual"
  };

  pendingRegisterData = modalData;
  window.pendingRegisterData = modalData;

  const partnerSummaryBox = document.getElementById("registerPartnerSummary");
  const partnerProfitBox = document.getElementById("registerPartnerProfit");
  const partnerTotalBox = document.getElementById("registerPartnerTotal");
  const partnerTotalLabelBox = document.getElementById("registerPartnerTotalLabel");
  const partnerCostWrapBox = document.getElementById("registerPartnerCostWrap");
  const partnerCostBox = document.getElementById("registerPartnerCost");

  function refreshPartnerRegisterSummary(){
    if(!partnerSummaryBox || !partnerProfitBox || !partnerTotalBox || !partnerTotalLabelBox) return;

    if(data.operatorMode === "socio"){
      partnerSummaryBox.style.display = "";
      partnerProfitBox.textContent = `${formatCalcValue(data.partnerProfitUsdt || 0, "USDT")} USDT`;

      const payerChoice = document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze";
      const partnerGain = Number(data.partnerProfitUsdt || 0);

      partnerTotalLabelBox.textContent = "Ganancia socio";
      partnerTotalBox.textContent = `${formatCalcValue(partnerGain, "USDT")} USDT`;

      const sendCost = Number(data.usdtDestValue || 0);
      if(partnerCostWrapBox) partnerCostWrapBox.style.display = "";
      if(partnerCostBox) partnerCostBox.textContent = `${formatCalcValue(sendCost, "USDT")} USDT`;
    } else {
      partnerSummaryBox.style.display = "none";
      partnerProfitBox.textContent = "—";
      partnerTotalLabelBox.textContent = "Ganancia socio";
      partnerTotalBox.textContent = "—";
      if(partnerCostWrapBox) partnerCostWrapBox.style.display = "none";
      if(partnerCostBox) partnerCostBox.textContent = "—";
    }
  }

  summaryRoute.textContent = `${data.originCountry} → ${data.destCountry}`;

  if(summaryProviderRateWrap && summaryProviderRate){
    if(data.operatorMode === "porcentaje" || data.operatorMode === "socio"){
      summaryProviderRateWrap.style.display = "none";
      summaryProviderRate.textContent = "—";
    } else {
      summaryProviderRateWrap.style.display = "";
      summaryProviderRate.textContent = data.providerRateFormatted;
    }
  }

  summaryClientRate.textContent = data.clientRateFormatted;
  summaryMargin.textContent = data.operatorMode === "socio" ? "50/50" : data.marginLabel;
  summarySend.textContent = data.sendAmountFormatted;
  summaryReceive.textContent = data.receiveAmountFormatted;

  if(summaryProviderPayWrap && summaryProviderPay){
    if(data.operatorMode === "porcentaje" && data.providerPayFormatted){
      summaryProviderPayWrap.style.display = "";
      summaryProviderPay.textContent = data.providerPayFormatted;
    } else {
      summaryProviderPayWrap.style.display = "none";
      summaryProviderPay.textContent = "—";
    }
  }

  clientName.value = "";
  refreshClientSuggestions();
  operationNumber.value = getNextOperationNumber();
  operationDate.value = todayISO();
  operationNote.value = "";

  const firstType = document.querySelector('input[name="operationType"][value="Cambio"]');
  if(firstType) firstType.checked = true;

  if(data.operatorMode === "socio"){
    profitCurrencyGroup.innerHTML = `
      <label class="radio-pill active">
        <input type="radio" name="profitCurrencyChoice" value="usdt" checked>
        USDT
      </label>
    `;
    if(payerSideGroup) payerSideGroup.style.display = "";
    const payerOnze = document.querySelector('input[name="payerSideChoice"][value="onze"]');
    if(payerOnze) payerOnze.checked = true;
  } else {
    profitCurrencyGroup.innerHTML = `
      <label class="radio-pill active">
        <input type="radio" name="profitCurrencyChoice" value="origin" checked>
        ${data.originCurrency}
      </label>
    `;
    if(payerSideGroup) payerSideGroup.style.display = "none";
  }

  if(profitConvertTarget) profitConvertTarget.innerHTML = '<option value="">Selecciona un país…</option>';
  const convertNo = document.querySelector('input[name="profitConvertChoice"][value="no"]');
  if(convertNo){
    convertNo.checked = true;
    document.querySelectorAll('#profitConvertQuestion .radio-pill').forEach(el => el.classList.remove('active'));
    convertNo.closest('.radio-pill')?.classList.add('active');
  }

  const paymentPaid = document.querySelector('input[name="paymentStatusChoice"][value="paid"]');
  if(paymentPaid){
    paymentPaid.checked = true;
    document.querySelectorAll('#paymentStatusChoices .radio-pill').forEach(el => el.classList.remove('active'));
    paymentPaid.closest('.radio-pill')?.classList.add('active');
  }

  refreshProfitConvertUI();
  refreshPartnerRegisterSummary();

  if(data.operatorMode === "socio" && payerSideChoices){
    payerSideChoices.querySelectorAll('input[name="payerSideChoice"]').forEach(input => {
      input.onchange = () => {
        refreshProfitConvertUI();
        refreshPartnerRegisterSummary();
      };
    });
  }

  registerModal.classList.add("open");
  registerModal.setAttribute("aria-hidden","false");
  document.body.classList.add("noscroll");
}

    function closeRegisterModal(){
      registerModal.classList.remove("open");
      registerModal.setAttribute("aria-hidden","true");
      document.body.classList.remove("noscroll");
      pendingRegisterData = null;
    }

    function savePendingOperation(){
      try{
        console.log("SAVE_PENDING_START", {
          hasPendingRegisterData: !!pendingRegisterData,
          pendingRegisterData,
          currentUserContext: CURRENT_USER_CONTEXT,
          activeCalculatorMode: (typeof getActiveCalculatorMode === "function" ? getActiveCalculatorMode() : null)
        });

        if(!requireProfileForAction("Debes completar tu perfil antes de registrar operaciones.")){
          return;
        }

        if(!pendingRegisterData){
          return;
        }

        const selectedType = document.querySelector('input[name="operationType"]:checked')?.value || "Cambio";

      const baseProfitCountry = pendingRegisterData.originCountry;
      const baseProfitCurrency = pendingRegisterData.originCurrency;
      const baseProfitValue = Number(pendingRegisterData.profitOriginValue || 0);

      let profitCountry = baseProfitCountry;
      let profitCurrency = baseProfitCurrency;
      let profitValue = baseProfitValue;

      const shouldConvertProfit = document.querySelector('input[name="profitConvertChoice"]:checked')?.value === "yes";
      const targetCountry = profitConvertTarget?.value || "";

      if(pendingRegisterData?.operatorMode === "socio"){
        const payerSide = document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze";

        profitCountry = "USDT";
        profitCurrency = "USDT";
        profitValue = Number(pendingRegisterData.partnerProfitUsdt || 0);
      }

      if(shouldConvertProfit && targetCountry){
        if(pendingRegisterData?.operatorMode === "socio"){
          const sellRate = getCountryTradeRate(targetCountry, "sell");
          if(Number.isFinite(sellRate)){
            profitCountry = targetCountry;
            profitCurrency = getCurrencyFor(targetCountry);
            profitValue = Number(profitValue || 0) * Number(sellRate || 0);
          }
        } else {
          const route = getProviderRoute(baseProfitCountry, targetCountry);
          if(route && isFinite(route.value)){
            profitCountry = targetCountry;
            profitCurrency = getCurrencyFor(targetCountry);
            profitValue = applyOp(Number(baseProfitValue || 0), Number(route.value), route.op);
          }
        }
      }

      const profitDisplay = `${formatCalcValue(Math.abs(profitValue), profitCurrency)} ${profitCurrency}`;
      const finalOperationNumber = operationNumber.value.trim() || getNextOperationNumber();
      const paymentStatus = document.querySelector('input[name="paymentStatusChoice"]:checked')?.value || "paid";

      const rawOperatorMode = String(
        pendingRegisterData?.operatorMode ||
        ((isGlobalAdmin() || isTenantAdmin()) ? getActiveCalculatorMode() : CURRENT_USER_CONTEXT?.operatorMode) ||
        ""
      ).trim().toLowerCase();

      const mappedOperatorMode = rawOperatorMode === "onze"
        ? "manual"
        : rawOperatorMode;

      const safeOperatorMode = ["libre", "porcentaje", "socio", "manual"].includes(mappedOperatorMode)
        ? mappedOperatorMode
        : "manual";

      const operationUsdtBase = toUsdtFromCountryAmount(
        pendingRegisterData.originCountry,
        pendingRegisterData.sendAmount
      );

      const opExtra = pendingRegisterData?.operatorMode === "socio"
        ? {
            payerSide: document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze",
            usdtOriginValue: pendingRegisterData.usdtOriginValue,
            usdtDestValue: pendingRegisterData.usdtDestValue,
            totalProfitUsdt: pendingRegisterData.totalProfitUsdt,
            partnerProfitUsdt: pendingRegisterData.partnerProfitUsdt,
            onzeProfitUsdt: pendingRegisterData.onzeProfitUsdt,
            totalOnzeUsdt: pendingRegisterData.totalOnzeUsdt,
            partnerPayoutProfitUsdt: Number(pendingRegisterData.partnerProfitUsdt || 0),
            partnerPayoutDestCostUsdt: (document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze") === "socio"
              ? Number(pendingRegisterData.usdtDestValue || 0)
              : 0,
            partnerPayoutTotalUsdt: (document.querySelector('input[name="payerSideChoice"]:checked')?.value || "onze") === "socio"
              ? Number(pendingRegisterData.usdtDestValue || 0) + Number(pendingRegisterData.partnerProfitUsdt || 0)
              : Number(pendingRegisterData.partnerProfitUsdt || 0)
          }
        : {};

      const originBuyRate = getCountryTradeRate(pendingRegisterData.originCountry, "buy");
      const destSellRate = getCountryTradeRate(pendingRegisterData.destCountry, "sell");

      const destinationSnapshot = getCountryBalanceSnapshot(
        pendingRegisterData.destCountry,
        pendingRegisterData.destCurrency
      );
      const availableDestBalance = Number(destinationSnapshot.balance || 0);
      const requiredDestAmount = Number(pendingRegisterData.receiveAmount || 0);
      const shortageAmount = Math.max(0, requiredDestAmount - availableDestBalance);
      const needsFunding = shortageAmount > 0;

      const op = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
        createdAt: new Date().toISOString(),
        date: operationDate.value || todayISO(),
        clientName: clientName.value.trim(),
        operatorMode: safeOperatorMode,
        operationNumber: finalOperationNumber,
        operationType: selectedType,
        paymentStatus,
        operationUsdtBase,
        amountCollectedUsdt: paymentStatus === "paid" ? operationUsdtBase : 0,
        amountPendingUsdt: paymentStatus === "pending" ? operationUsdtBase : (paymentStatus === "partial" ? operationUsdtBase : 0),
        note: operationNote.value.trim(),
        originCountry: pendingRegisterData.originCountry,
        destCountry: pendingRegisterData.destCountry,
        originCurrency: pendingRegisterData.originCurrency,
        destCurrency: pendingRegisterData.destCurrency,
        sendAmount: pendingRegisterData.sendAmount,
        receiveAmount: pendingRegisterData.receiveAmount,
        sendAmountFormatted: pendingRegisterData.sendAmountFormatted,
        receiveAmountFormatted: pendingRegisterData.receiveAmountFormatted,
        providerRate: pendingRegisterData.providerRate,
        clientRate: pendingRegisterData.clientRate,
        providerRateFormatted: pendingRegisterData.providerRateFormatted,
        clientRateFormatted: pendingRegisterData.clientRateFormatted,
        marginLabel: pendingRegisterData.marginLabel,
        profitOriginValue: pendingRegisterData.profitOriginValue,
        profitDestValue: pendingRegisterData.profitDestValue,
        profitCurrency,
        profitCountry,
        profitValue,
        profitDisplay,
        liquidityStatus: needsFunding ? "requiere_fondeo" : "ok",
        needsFunding,
        liquidityShortage: shortageAmount,
        shortageCountry: needsFunding ? pendingRegisterData.destCountry : "",
        shortageCurrency: needsFunding ? pendingRegisterData.destCurrency : "",
        availableDestBalance,
        buyOriginValue: Number.isFinite(originBuyRate) ? Number(originBuyRate) : null,
        sellDestinationValue: Number.isFinite(destSellRate) ? Number(destSellRate) : null,
        operatorProfitFinalAmount: Number(
          opExtra.partnerPayoutTotalUsdt ||
          opExtra.partnerPayoutProfitUsdt ||
          profitValue ||
          0
        ),
        operatorProfitFinalCurrencyCode: String(
          opExtra.partnerPayoutTotalUsdt || opExtra.partnerPayoutProfitUsdt
            ? "USDT"
            : (profitCurrency || op.originCurrency || "")
        ).trim().toUpperCase() || null,
        operatorProfitConverted: Boolean(
          opExtra.partnerPayoutTotalUsdt || opExtra.partnerPayoutProfitUsdt || (profitCurrency && profitCurrency !== pendingRegisterData.originCurrency)
        ),
        ...opExtra
      };

      rememberClient(op.clientName);

      (async ()=>{
        try{
          const res = await fetch("/api/operations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: op.date,
              operationNumber: op.operationNumber,
              operationType: op.operationType,
              note: op.note,
              clientName: op.clientName,
              operatorMode: op.operatorMode,
              originCountry: op.originCountry,
              destCountry: op.destCountry,
              originCurrency: op.originCurrency,
              destCurrency: op.destCurrency,
              sendAmount: op.sendAmount,
              receiveAmount: op.receiveAmount,
              providerRate: op.providerRate,
              clientRate: op.clientRate,
              buyOriginValue: op.buyOriginValue,
              sellDestinationValue: op.sellDestinationValue,
              operatorProfitFinalAmount: op.operatorProfitFinalAmount,
              operatorProfitFinalCurrencyCode: op.operatorProfitFinalCurrencyCode,
              operatorProfitConverted: op.operatorProfitConverted,
              profitCountry: op.profitCountry,
              profitCurrency: op.profitCurrency,
              profitValue: op.profitValue,
              liquidityStatus: op.liquidityStatus,
              needsFunding: op.needsFunding,
              liquidityShortage: op.liquidityShortage,
              shortageCountry: op.shortageCountry,
              shortageCurrency: op.shortageCurrency,
              payoutCurrencyMode: op.payerSide === "socio" ? "usdt" : null,
              payoutAmountToOperator: op.partnerPayoutTotalUsdt || op.partnerPayoutProfitUsdt || null,
              payoutCurrencyCode: op.payerSide === "socio" ? "USDT" : null,
              payoutUsdtAmount: op.partnerPayoutTotalUsdt || op.partnerPayoutProfitUsdt || null
            })
          });

          const data = await res.json().catch(()=>({}));

          if(!res.ok){
            console.error("SAVE_OPERATION_RESPONSE_ERROR", {
              status: res.status,
              data,
              payload: op
            });
            throw new Error(data?.error || "No se pudo guardar la operación.");
          }

          registerProviderMovementFromOperation(op, data?.operation?.id || op.id);

          const latestOps = await fetchOperationsFromApi();
          rebuildBalanceMovementsFromOperations((latestOps || []).filter(op => !op.deleted));

          if(needsFunding){
            addLiquidityAlert({
              operationId: String(data?.operation?.id || op.id || ""),
              country: op.destCountry,
              currency: op.destCurrency,
              availableAmount: availableDestBalance,
              requiredAmount: requiredDestAmount,
              shortageAmount,
              note: `Faltante detectado al registrar la operación ${op.operationNumber}`
            });
          }

          refreshHistoryUI();
          closeRegisterModal();
          switchView("dashboard");
          showToast("Operación guardada ✅");
        }catch(error){
          console.error("SAVE_OPERATION_ERROR", error);
          showToast(error?.message || "No se pudo guardar la operación");
        }
      })();
      }catch(error){
        console.error("SAVE_PENDING_SYNC_ERROR", error);
        showToast(error?.message || "No se pudo guardar la operación");
      }
    }

    function updateTitle(){
      title.textContent = "Centro de operaciones";
    }

    function render(data){
      const pais = sel.value;
      const perc = selectedProfit == null ? null : Number(selectedProfit);
      const curOrigin = pais ? getCurrencyFor(pais) : "";

      updateTitle();
      ratesBox.innerHTML = "";

      if(!pais){
        copyCountryBtn.disabled = true;
        return;
      }

      const arr = currentFilteredArray(data);

      if(!showAllRates && !destSel.value){
        copyCountryBtn.disabled = true;
        return;
      }

      if(!arr.length){
        errorBox.textContent = "No hay tasas disponibles para esta selección.";
        errorBox.style.display = "block";
        copyCountryBtn.disabled = true;
        return;
      }

      errorBox.style.display = "none";

      arr.forEach(item=>{
        const hasVal = item.value !== null && item.value !== undefined;
        const destCur = getCurrencyFor(item.dest);
        const providerRate = hasVal ? (item.providerRateText || fmtCL(item.value, item.decimals)) : "—";
        const clientRateNum = rateForCalc(item);
        const visibleRateMeta = getVisibleBaseRate(item);
        const visibleRateRaw = visibleRateMeta ? visibleRateMeta.value : null;
        const visibleRateNum = (visibleRateRaw === null || visibleRateRaw === undefined || visibleRateRaw === "")
          ? null
          : Number(visibleRateRaw);
        const visibleRate = (visibleRateNum !== null && Number.isFinite(visibleRateNum))
          ? fmtCL(visibleRateNum, item.decimals)
          : "—";
        const finalRate = hasVal && isFinite(clientRateNum)
          ? fmtCL(clientRateNum, item.decimals)
          : visibleRate;

        const rowKey = keyFor(pais, item.dest);
        const state = getCalcState(rowKey);

        const card = document.createElement("div");
        card.className = "rate-card";

        const head = document.createElement("div");
        head.className = "rate-head";

        const titleWrap = document.createElement("div");
        titleWrap.className = "rate-main";

        if(isFixedPercentOperator() || isPartnerOperator() || isOnzeCalculator()){
          titleWrap.innerHTML = `<p class="rate-title">${pais.toUpperCase()} → ${item.dest.toUpperCase()}: ${finalRate}</p>`;
        }else if(perc == null){
          titleWrap.innerHTML = `<p class="rate-title">${pais.toUpperCase()} → ${item.dest.toUpperCase()}: ${providerRate}</p>`;
        }else{
          titleWrap.innerHTML = `
            <p class="rate-title">${pais.toUpperCase()} → ${item.dest.toUpperCase()}: ${finalRate}</p>
            <div class="rate-lines">
              <div class="rate-provider">Tasa proveedor: <strong>${providerRate}</strong></div>
            </div>
          `;
        }


        const copy = document.createElement("button");
        copy.className = "copy-btn";
        copy.title = "Copiar tasa";
        copy.setAttribute("aria-label", "Copiar tasa");
        copy.dataset.copy = `${pais} → ${item.dest}: ${(isFixedPercentOperator() || isPartnerOperator() || isOnzeCalculator()) ? finalRate : finalRate}`;
        copy.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="11" height="11" rx="2" stroke-width="2"/><rect x="4" y="4" width="11" height="11" rx="2" stroke-width="2"/></svg>';
        if(!hasVal) copy.disabled = true;

        head.appendChild(titleWrap);
        head.appendChild(copy);
        card.appendChild(head);

        if(calcEnabled){
          const shell = document.createElement("div");
          shell.className = "calc-shell";

          const grid = document.createElement("div");
          grid.className = "calc-grid";

          const leftCol = document.createElement("div");
          leftCol.className = "calc-col";
          leftCol.innerHTML = `<div class="calc-col-top"><span>ENVÍAS</span><span>${curOrigin || "MON"}</span></div>`;

          const leftWrap = document.createElement("div");
          leftWrap.className = "calc-input-wrap";

          const originInput = document.createElement("input");
          originInput.className = "calc-input";
          originInput.type = "text";
          originInput.placeholder = "Monto";
          originInput.inputMode = "decimal";
          originInput.autocomplete = "off";
          originInput.value = state.origin;

          leftWrap.appendChild(originInput);
          leftCol.appendChild(leftWrap);

          const mid = document.createElement("div");
          mid.style.display = "flex";
          mid.style.justifyContent = "center";
          mid.style.alignItems = "center";

          const swap = document.createElement("button");
          swap.className = "swap-btn";
          swap.type = "button";
          swap.title = "Intercambiar valores";
          swap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7H19M19 7L15 3M19 7L15 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 17H5M5 17L9 13M5 17L9 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          mid.appendChild(swap);

          const rightCol = document.createElement("div");
          rightCol.className = "calc-col";
          rightCol.innerHTML = `<div class="calc-col-top"><span>RECIBE</span><span>${destCur}</span></div>`;

          const rightWrap = document.createElement("div");
          rightWrap.className = "calc-input-wrap";

          const destInput = document.createElement("input");
          destInput.className = "calc-input";
          destInput.type = "text";
          destInput.placeholder = "Resultado";
          destInput.inputMode = "decimal";
          destInput.autocomplete = "off";
          destInput.value = state.dest;

          rightWrap.appendChild(destInput);
          rightCol.appendChild(rightWrap);

          leftWrap.classList.add("calc-copyable");
          rightWrap.classList.add("calc-copyable");

          grid.appendChild(leftCol);
          grid.appendChild(mid);
          grid.appendChild(rightCol);
          shell.appendChild(grid);

          const hint = document.createElement("div");
          hint.className = "calc-hint";
          hint.textContent = "Toca el resultado para copiar";
          shell.appendChild(hint);

          const calcNotice = document.createElement("div");
          calcNotice.className = "calc-hint";
          calcNotice.style.display = "none";
          calcNotice.style.color = "#fca5a5";
          calcNotice.style.fontWeight = "700";
          shell.appendChild(calcNotice);

          const simBox = document.createElement("div");
          simBox.className = "sim-box";
          simBox.innerHTML = isFiftyFiftyPartner()
            ? `
              <div class="sim-title">Simulador de utilidad</div>
              <div class="sim-grid">
                <div class="sim-item">
                  <div class="sim-label">Tasa detal</div>
                  <div class="sim-value" data-role="client-rate">${finalRate}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Margen aplicado</div>
                  <div class="sim-value" data-role="margin">50/50</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Monto cliente</div>
                  <div class="sim-value" data-role="client-amount">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">¿Aplicar comisión?</div>
                  <div class="sim-value" data-role="partner-commission-control">
                    <label style="display:flex; align-items:center; gap:8px; justify-content:flex-end;">
                      <input type="checkbox" data-role="partner-commission-toggle" />
                      <span>Sí</span>
                    </label>
                  </div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Comisión operativa %</div>
                  <div class="sim-value" data-role="partner-commission-wrap" style="display:none; gap:8px; align-items:center; justify-content:flex-end;">
                    <input
                      type="text"
                      inputmode="decimal"
                      placeholder="Ej: 1,5"
                      data-role="partner-commission-input"
                      style="width:120px; background:#10284b; border:1px solid rgba(255,255,255,.12); color:#fff; border-radius:10px; padding:8px 10px; text-align:right;"
                    />
                    <span data-role="partner-commission">0%</span>
                  </div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Origen neto (${curOrigin || "MON"})</div>
                  <div class="sim-value" data-role="origin-net">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">USDT origen</div>
                  <div class="sim-value" data-role="usdt-origin">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">USDT destino</div>
                  <div class="sim-value" data-role="usdt-dest">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Ganancia total USDT</div>
                  <div class="sim-value profit" data-role="partner-total-profit">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Ganancia socio USDT</div>
                  <div class="sim-value profit" data-role="partner-profit">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Ganancia ONZE USDT</div>
                  <div class="sim-value profit" data-role="onze-profit">—</div>
                </div>
                <div class="sim-item" style="grid-column:1 / -1;">
                  <div class="sim-label">Total para ONZE USDT</div>
                  <div class="sim-value" data-role="onze-total">—</div>
                </div>
              </div>
            `
            : (isFixedPercentOperator() || isPartnerOperator())
            ? `
              <div class="sim-title">Simulador de utilidad</div>
              <div class="sim-grid">
                <div class="sim-item">
                  <div class="sim-label">Tasa detal</div>
                  <div class="sim-value" data-role="client-rate">${finalRate}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Margen aplicado</div>
                  <div class="sim-value" data-role="margin">${fmtPct(getFixedPercentValue())}%</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Monto cliente</div>
                  <div class="sim-value" data-role="client-amount">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Total a pagar proveedor (${curOrigin || "MON"})</div>
                  <div class="sim-value" data-role="provider-pay">—</div>
                </div>
                <div class="sim-item" style="grid-column:1 / -1;">
                  <div class="sim-label">Ganancia estimada (${curOrigin || "MON"})</div>
                  <div class="sim-value profit" data-role="profit-origin">—</div>
                </div>
              </div>
            `
            : isFreeOperator()
            ? `
              <div class="sim-title">Simulador de utilidad</div>
              <div class="sim-grid">
                <div class="sim-item">
                  <div class="sim-label">Tasa proveedor</div>
                  <div class="sim-value" data-role="provider-rate">${providerRate}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Tu tasa</div>
                  <div class="sim-value" data-role="client-rate">${finalRate}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Margen aplicado</div>
                  <div class="sim-value" data-role="margin">${perc == null ? 'Base' : fmtPct(perc) + '%'}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Costo proveedor</div>
                  <div class="sim-value" data-role="provider-amount">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Monto cliente</div>
                  <div class="sim-value" data-role="client-amount">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Ganancia estimada (${destCur})</div>
                  <div class="sim-value profit" data-role="profit-dest">—</div>
                </div>
                <div class="sim-item" style="grid-column:1 / -1;">
                  <div class="sim-label">Ganancia estimada (${curOrigin || "MON"})</div>
                  <div class="sim-value profit" data-role="profit-origin">—</div>
                </div>
              </div>
            `
            : `
              <div class="sim-title">Simulador de utilidad</div>
              <div class="sim-grid">
                <div class="sim-item">
                  <div class="sim-label">Tasa detal</div>
                  <div class="sim-value" data-role="client-rate">${finalRate}</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Margen aplicado</div>
                  <div class="sim-value" data-role="margin">Base</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Monto cliente</div>
                  <div class="sim-value" data-role="client-amount">—</div>
                </div>
                <div class="sim-item">
                  <div class="sim-label">Ganancia estimada (${destCur})</div>
                  <div class="sim-value profit" data-role="profit-dest">—</div>
                </div>
                <div class="sim-item" style="grid-column:1 / -1;">
                  <div class="sim-label">Ganancia estimada (${curOrigin || "MON"})</div>
                  <div class="sim-value profit" data-role="profit-origin">—</div>
                </div>
              </div>
            `;

          shell.appendChild(simBox);

          const registerRow = document.createElement("div");
          registerRow.className = "register-row";

          const registerBtn = document.createElement("button");
          registerBtn.className = "btn small";
          registerBtn.type = "button";
          registerBtn.textContent = "Registrar operación";

          registerRow.appendChild(registerBtn);
          shell.appendChild(registerRow);
          card.appendChild(shell);

          const providerAmountEl = simBox.querySelector('[data-role="provider-amount"]');
          const clientAmountEl = simBox.querySelector('[data-role="client-amount"]');
          const providerPayEl = simBox.querySelector('[data-role="provider-pay"]');
          const profitDestEl = simBox.querySelector('[data-role="profit-dest"]');
          const profitOriginEl = simBox.querySelector('[data-role="profit-origin"]');
          const clientRateEl = simBox.querySelector('[data-role="client-rate"]');
          const marginEl = simBox.querySelector('[data-role="margin"]');
          const partnerCommissionEl = simBox.querySelector('[data-role="partner-commission"]');
          const partnerCommissionToggleEl = simBox.querySelector('[data-role="partner-commission-toggle"]');
          const partnerCommissionInputEl = simBox.querySelector('[data-role="partner-commission-input"]');
          const partnerCommissionWrapEl = simBox.querySelector('[data-role="partner-commission-wrap"]');
          const originNetEl = simBox.querySelector('[data-role="origin-net"]');
          const usdtOriginEl = simBox.querySelector('[data-role="usdt-origin"]');
          const usdtDestEl = simBox.querySelector('[data-role="usdt-dest"]');
          const partnerTotalProfitEl = simBox.querySelector('[data-role="partner-total-profit"]');
          const partnerProfitEl = simBox.querySelector('[data-role="partner-profit"]');
          const onzeProfitEl = simBox.querySelector('[data-role="onze-profit"]');
          const onzeTotalEl = simBox.querySelector('[data-role="onze-total"]');
          const calcNoticeEl = calcNotice;

          let currentRegisterPayload = null;
          let partnerCommissionDraft = 0;

          if(partnerCommissionToggleEl && partnerCommissionWrapEl){
            partnerCommissionToggleEl.addEventListener("change", () => {
              const enabled = !!partnerCommissionToggleEl.checked;
              partnerCommissionWrapEl.style.display = enabled ? "flex" : "none";

              if(!enabled){
                partnerCommissionDraft = 0;
                if(partnerCommissionInputEl) partnerCommissionInputEl.value = "";
                if(partnerCommissionEl) partnerCommissionEl.textContent = "0%";
              }

              updateSimulator();
            });
          }

          if(partnerCommissionInputEl){
            partnerCommissionInputEl.addEventListener("input", () => {
              const raw = String(partnerCommissionInputEl.value || "").trim().replace(",", ".");
              const num = Number(raw);

              partnerCommissionDraft = Number.isFinite(num) && num >= 0 ? num : 0;

              if(partnerCommissionEl){
                partnerCommissionEl.textContent = `${partnerCommissionDraft}%`;
              }

              updateSimulator();
            });
          }

          function updateSimulator(){
            const providerRateNum = isOnzeCalculator()
              ? Number(item.costRate ?? item.value)
              : item.value;
            const clientRateNumLocal = rateForCalc(item);

            clientRateEl.textContent = Number.isFinite(clientRateNumLocal) ? fmtCL(clientRateNumLocal, item.decimals) : "—";
            marginEl.textContent = isFixedPercentOperator()
              ? `${fmtPct(getFixedPercentValue())}%`
              : (perc == null ? "Base" : fmtPct(perc) + "%");

            const missingRetailRate =
              (isFixedPercentOperator() || isPartnerOperator()) &&
              !Number.isFinite(clientRateNumLocal);

            if(missingRetailRate){
              originInput.readOnly = true;
              destInput.readOnly = true;
              registerBtn.disabled = true;
              registerBtn.style.opacity = "0.6";
              registerBtn.style.cursor = "not-allowed";

              if(calcNoticeEl){
                calcNoticeEl.style.display = "block";
                calcNoticeEl.textContent = "No existe tasa detal para esta ruta. No se puede calcular ni registrar la operación.";
              }

              if(clientRateEl) clientRateEl.textContent = "—";
              if(clientAmountEl) clientAmountEl.textContent = "—";
              if(providerAmountEl) providerAmountEl.textContent = "—";
              if(providerPayEl) providerPayEl.textContent = "—";
              if(profitDestEl) profitDestEl.textContent = "—";
              if(profitOriginEl) profitOriginEl.textContent = "—";

              destInput.value = "";
              state.dest = "";
              currentRegisterPayload = null;
              registerBtn._payload = null;
              return;
            } else {
              originInput.readOnly = false;
              destInput.readOnly = false;
              registerBtn.disabled = false;
              registerBtn.style.opacity = "";
              registerBtn.style.cursor = "";
              if(calcNoticeEl){
                calcNoticeEl.style.display = "none";
                calcNoticeEl.textContent = "";
              }
            }

            let originAmount = parseHumanNumber(originInput.value);

            if(!isFinite(originAmount)){
              const destRaw = parseHumanNumber(destInput.value);
              if(Number.isFinite(destRaw) && Number.isFinite(clientRateNumLocal)){
                originAmount = invertOp(destRaw, clientRateNumLocal, item.op);
              }
            }

            if(!Number.isFinite(originAmount) || !Number.isFinite(clientRateNumLocal)){
              if(providerAmountEl) providerAmountEl.textContent = "—";
              if(clientAmountEl) clientAmountEl.textContent = "—";
              if(providerPayEl) providerPayEl.textContent = "—";
              if(profitDestEl) profitDestEl.textContent = "—";
              if(profitOriginEl) profitOriginEl.textContent = "—";
              currentRegisterPayload = null;
              return;
            }

            const clientAmountDest = applyOp(originAmount, clientRateNumLocal, item.op);
            if(clientAmountEl) clientAmountEl.textContent = `${formatCalcValue(clientAmountDest, destCur)} ${destCur}`;

            if(isFiftyFiftyPartner()){
              const commissionPct =
                partnerCommissionToggleEl?.checked
                  ? (Number.isFinite(partnerCommissionDraft) ? partnerCommissionDraft : 0)
                  : 0;

              const originBuyRate = getCountryTradeRate(pais, "buy");
              const destSellRate = getCountryTradeRate(item.dest, "sell");

              const metrics = calcPartner5050Metrics({
                originAmount,
                receiveAmount: clientAmountDest,
                originBuyRate,
                destSellRate,
                commissionPercent: commissionPct
              });

              if(marginEl) marginEl.textContent = "50/50";
              if(partnerCommissionEl) partnerCommissionEl.textContent = `${fmtPct(commissionPct)}%`;

              if(!metrics){
                if(originNetEl) originNetEl.textContent = "—";
                if(usdtOriginEl) usdtOriginEl.textContent = "—";
                if(usdtDestEl) usdtDestEl.textContent = "—";
                if(partnerTotalProfitEl) partnerTotalProfitEl.textContent = "—";
                if(partnerProfitEl) partnerProfitEl.textContent = "—";
                if(onzeProfitEl) onzeProfitEl.textContent = "—";
                if(onzeTotalEl) onzeTotalEl.textContent = "—";
                currentRegisterPayload = null;
                registerBtn._payload = null;
                return;
              }

              if(originNetEl) originNetEl.textContent = `${formatCalcValue(metrics.originNet, curOrigin)} ${curOrigin}`;
              if(usdtOriginEl) usdtOriginEl.textContent = `${formatCalcValue(metrics.usdtOrigin, "USDT")} USDT`;
              if(usdtDestEl) usdtDestEl.textContent = `${formatCalcValue(metrics.usdtDest, "USDT")} USDT`;
              if(partnerTotalProfitEl) partnerTotalProfitEl.textContent = `${formatCalcValue(metrics.totalProfit, "USDT")} USDT`;
              if(partnerProfitEl) partnerProfitEl.textContent = `${formatCalcValue(metrics.partnerProfit, "USDT")} USDT`;
              if(onzeProfitEl) onzeProfitEl.textContent = `${formatCalcValue(metrics.onzeProfit, "USDT")} USDT`;
              if(onzeTotalEl) onzeTotalEl.textContent = `${formatCalcValue(metrics.totalOnze, "USDT")} USDT`;

              currentRegisterPayload = {
                originCountry: pais,
                destCountry: item.dest,
                originCurrency: curOrigin,
                destCurrency: destCur,
                providerRate: item.providerRate,
                clientRate: clientRateNumLocal,
                providerRateFormatted: Number.isFinite(item.providerRate) ? fmtCL(item.providerRate, item.decimals) : "—",
                clientRateFormatted: fmtCL(clientRateNumLocal, item.decimals),
                marginLabel: "50/50",
                sendAmount: originAmount,
                receiveAmount: clientAmountDest,
                sendAmountFormatted: `${formatCalcValue(originAmount, curOrigin)} ${curOrigin}`,
                receiveAmountFormatted: `${formatCalcValue(clientAmountDest, destCur)} ${destCur}`,
                operatorMode: "socio",
                partnerCommissionPercent: commissionPct,
                originBuyRate,
                destSellRate,
                originNetValue: metrics.originNet,
                usdtOriginValue: metrics.usdtOrigin,
                usdtDestValue: metrics.usdtDest,
                totalProfitUsdt: metrics.totalProfit,
                partnerProfitUsdt: metrics.partnerProfit,
                onzeProfitUsdt: metrics.onzeProfit,
                totalOnzeUsdt: metrics.totalOnze
              };
              registerBtn._payload = currentRegisterPayload;
              return;
            }

            if(isFixedPercentOperator()){
              const fixedProfitOrigin = calcFixedPercentProfitFromOrigin(originAmount);

              const providerPay = originAmount - fixedProfitOrigin;

              if(providerAmountEl) providerAmountEl.textContent = "—";
              if(providerPayEl) providerPayEl.textContent = `${formatCalcValue(providerPay, curOrigin)} ${curOrigin}`;
              if(profitDestEl) profitDestEl.textContent = "—";
              if(profitOriginEl){
                profitOriginEl.textContent = `${formatCalcValue(Math.abs(fixedProfitOrigin), curOrigin)} ${curOrigin}`;
              }

              currentRegisterPayload = {
                originCountry: pais,
                destCountry: item.dest,
                originCurrency: curOrigin,
                destCurrency: destCur,
                providerRate: providerRateNum,
                clientRate: clientRateNumLocal,
                providerRateFormatted: isFinite(providerRateNum) ? fmtCL(providerRateNum, item.decimals) : "—",
                clientRateFormatted: fmtCL(clientRateNumLocal, item.decimals),
                marginLabel: `${fmtPct(getFixedPercentValue())}%`,
                sendAmount: originAmount,
                receiveAmount: clientAmountDest,
                sendAmountFormatted: `${formatCalcValue(originAmount, curOrigin)} ${curOrigin}`,
                receiveAmountFormatted: `${formatCalcValue(clientAmountDest, destCur)} ${destCur}`,
                profitOriginValue: fixedProfitOrigin,
                profitDestValue: 0,
                providerPayValue: providerPay,
                providerPayFormatted: `${formatCalcValue(providerPay, curOrigin)} ${curOrigin}`,
                operatorMode: "porcentaje"
              };
              registerBtn._payload = currentRegisterPayload;
              return;
            }

            if(!isFinite(providerRateNum)){
              if(providerAmountEl) providerAmountEl.textContent = "—";
              if(profitDestEl) profitDestEl.textContent = "—";
              if(profitOriginEl) profitOriginEl.textContent = "—";
              currentRegisterPayload = null;
              return;
            }

            const providerAmountDest = applyOp(originAmount, providerRateNum, item.op);
            const detailAmountDest = clientAmountDest;
            const profitDest = providerAmountDest - detailAmountDest;
            const profitOrigin = invertOp(Math.abs(profitDest), providerRateNum, item.op);

            if(providerAmountEl) providerAmountEl.textContent = `${formatCalcValue(providerAmountDest, destCur)} ${destCur}`;

            const signDest = profitDest >= 0 ? "+" : "-";
            const signOrigin = profitDest >= 0 ? "+" : "-";

            if(profitDestEl) profitDestEl.textContent = `${signDest} ${formatCalcValue(Math.abs(profitDest), destCur)} ${destCur}`;
            if(profitOriginEl) profitOriginEl.textContent = `${signOrigin} ${formatCalcValue(Math.abs(profitOrigin), curOrigin)} ${curOrigin}`;

            currentRegisterPayload = {
              originCountry: pais,
              destCountry: item.dest,
              originCurrency: curOrigin,
              destCurrency: destCur,
              providerRate: providerRateNum,
              clientRate: clientRateNumLocal,
              providerRateFormatted: fmtCL(providerRateNum, item.decimals),
              clientRateFormatted: fmtCL(clientRateNumLocal, item.decimals),
              marginLabel: perc == null ? "Base" : fmtPct(perc) + "%",
              sendAmount: originAmount,
              receiveAmount: clientAmountDest,
              sendAmountFormatted: `${formatCalcValue(originAmount, curOrigin)} ${curOrigin}`,
              receiveAmountFormatted: `${formatCalcValue(clientAmountDest, destCur)} ${destCur}`,
              profitOriginValue: profitOrigin,
              profitDestValue: profitDest,
              operatorMode: (isGlobalAdmin() || isTenantAdmin()) ? (isOnzeCalculator() ? "manual" : "libre") : (String(CURRENT_USER_CONTEXT.operatorMode || "").trim().toLowerCase() || "libre")
            };
            registerBtn._payload = currentRegisterPayload;
          }

          function recomputeFromOrigin(){
            const amount = parseHumanNumber(originInput.value);
            state.origin = originInput.value;
            state.active = "origin";
            const r = rateForCalc(item);
            const result = applyOp(amount, r, item.op);
            state.dest = isFinite(result) ? formatCalcValue(result, destCur) : "";
            destInput.value = state.dest;
            updateSimulator();
          }

          function recomputeFromDest(){
            const amount = parseHumanNumber(destInput.value);
            state.dest = destInput.value;
            state.active = "dest";
            const r = rateForCalc(item);
            const result = invertOp(amount, r, item.op);
            state.origin = isFinite(result) ? formatCalcValue(result, curOrigin) : "";
            originInput.value = state.origin;
            updateSimulator();
          }

          originInput.addEventListener("input", ()=>{
            state.origin = originInput.value;
            state.active = "origin";
            recomputeFromOrigin();
          });

          destInput.addEventListener("input", ()=>{
            state.dest = destInput.value;
            state.active = "dest";
            recomputeFromDest();
          });

          originInput.addEventListener("blur", ()=>{
            const raw = parseHumanNumber(originInput.value);
            originInput.value = Number.isFinite(raw) ? formatCalcValue(raw, curOrigin) : "";
            recomputeFromOrigin();
          });

          destInput.addEventListener("blur", ()=>{
            const raw = parseHumanNumber(destInput.value);
            destInput.value = Number.isFinite(raw) ? formatCalcValue(raw, destCur) : "";
            recomputeFromDest();
          });

          leftWrap.addEventListener("click", ()=>{
            if(state.active === "dest" && originInput.value){
              copyText(`${originInput.value} ${curOrigin}`);
            }
          });

          rightWrap.addEventListener("click", ()=>{
            if(state.active === "origin" && destInput.value){
              copyText(`${destInput.value} ${destCur}`);
            }
          });

          swap.addEventListener("click", ()=>{
            const a = originInput.value;
            const b = destInput.value;
            originInput.value = b;
            destInput.value = a;
            state.origin = b;
            state.dest = a;
            updateSimulator();
          });

          registerBtn.addEventListener("click", ()=>{
            const payload = registerBtn._payload || currentRegisterPayload;
            if(!payload){
              showToast("Primero calcula una operación");
              return;
            }
            openRegisterModal(payload);
          });

          if(state.active === "dest" && state.dest) recomputeFromDest();
          else if(state.origin) recomputeFromOrigin();
          else updateSimulator();
        }

        ratesBox.appendChild(card);
      });

      copyCountryBtn.disabled = false;
    }

    ratesBox.addEventListener("click", (ev)=>{
      const btn = ev.target.closest(".copy-btn");
      if(!btn || btn.hasAttribute("disabled")) return;
      const txt = btn.dataset.copy || "";
      if(txt) copyText(txt);
    });

    function copyCountryRates(currentData){
      const pais = sel.value;
      if(!pais) return;

      const arr = currentFilteredArray(currentData);
      if(!arr.length){
        showToast("No hay tasas para copiar");
        return;
      }

      const perc = selectedProfit == null ? null : Number(selectedProfit);
      const ts = new Date().toLocaleString("es-CL");

      const lines = arr.map(item=>{
        if(item.value == null) return `${pais} → ${item.dest}: —`;
        if(perc == null) return `${pais} → ${item.dest}: ${fmtCL(item.value, item.decimals)}`;
        const adj = adjustedValue(item.value, perc, item.mode);
        return `${pais} → ${item.dest}: ${fmtCL(adj, item.decimals)} (PROVEDOR ${fmtCL(item.value, item.decimals)})`;
      });

      copyText(`ONZE — ${pais} ( ${ts} )\n` + lines.join("\n"));
    }

    // El CSV lo publica Google Sheets — de vez en cuando esa redirección
    // (docs.google.com → googleusercontent.com) falla o tarda de forma
    // pasajera ("Failed to fetch"), sin que sea un error real de nuestro
    // código. En vez de mostrar el error, reintenta un par de veces antes
    // de rendirse — el mismo efecto que lograba un refresh manual.
    async function fetchCsvWithRetry(url, attempts = 3){
      let lastErr;
      for(let i = 0; i < attempts; i++){
        try{
          const res = await fetch(url + (url.includes("?") ? "&" : "?") + "cacheBust=" + Date.now());
          if(!res.ok) throw new Error("No se pudo leer el CSV publicado (HTTP " + res.status + ")");
          return await res.text();
        }catch(e){
          lastErr = e;
          if(i < attempts - 1) await new Promise(r => setTimeout(r, 800));
        }
      }
      throw lastErr;
    }

    async function fetchAndRender(resetCalculators = false){
      const prevSelection = sel.value || "";
      const prevDestination = destSel.value || "";
      try{
        if(resetCalculators){
          calcBidirectional.clear();
        }

        errorBox.style.display = "none";
        const txt = await fetchCsvWithRetry(CSV_URL);
        const rows = parseCSV(txt);
        if(!rows.length) throw new Error("El CSV está vacío.");

        const {origins, data, countryTradeRates} = buildDataRobust(rows);
        COUNTRY_TRADE_RATES = countryTradeRates || {};
        console.log("COUNTRY_TRADE_RATES", COUNTRY_TRADE_RATES);
        if(!origins.length) throw new Error("No se encontraron países.");

        populateCountries(origins, prevSelection);
        populateDestinations(data, sel.value, prevDestination);

        lastDataSnapshot = data;
        window.lastDataSnapshot = data;
        render(data);
        renderCountryProfit(loadOperations());
        renderInitialCapital();
        refreshDashboard();
        if(typeof populateCountrySelect === "function"){
          populateCountrySelect(profileResidenceCountry);
        }
        populateCountrySelect(profileResidenceCountry);
        updateProfileUI();
        copyCountryBtn.onclick = ()=>copyCountryRates(data);
      }catch(e){
        errorBox.textContent = "Error: " + e.message;
        errorBox.style.display = "block";
      }
    }

    function requestRerender(){
      if(lastDataSnapshot) render(lastDataSnapshot);
    }

    sel.addEventListener("change", ()=>{
      showAllRates = false;
      viewAllBtn.textContent = "Ver todas las tasas";
      destSel.value = "";
      populateDestinations(lastDataSnapshot || {}, sel.value, "");
      copyCountryBtn.disabled = !sel.value;
      requestRerender();
    });

    destSel.addEventListener("change", ()=>{
      showAllRates = false;
      viewAllBtn.textContent = "Ver todas las tasas";
      requestRerender();
    });

    viewAllBtn.addEventListener("click", ()=>{
      if(!sel.value) return;
      showAllRates = !showAllRates;
      viewAllBtn.textContent = showAllRates ? "Ver solo tasa seleccionada" : "Ver todas las tasas";
      requestRerender();
    });

    refreshBtn.addEventListener("click", ()=>{
      fetchAndRender(true);
    });

    toggleCalc.addEventListener("click", ()=>{
      calcEnabled = !calcEnabled;
      toggleCalc.setAttribute("aria-pressed", String(calcEnabled));
      calcState.textContent = calcEnabled ? "ON" : "OFF";
      requestRerender();
    });

    profitBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const open = profitMenu.classList.toggle("open");
      profitBtn.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("noscroll", open);
    });

    profitMenu.addEventListener("click", (e)=>{
      const btn = e.target.closest("button");
      if(!btn) return;

      if(btn.dataset.mode === "base"){
        selectedProfit = null;
        pctBadge.textContent = "";
        pctBadge.classList.remove("show");
        profitMenu.classList.remove("open");
        profitBtn.setAttribute("aria-expanded","false");
        document.body.classList.remove("noscroll");
        requestRerender();
        return;
      }

      if(btn.dataset.p){
        selectedProfit = Number(btn.dataset.p);
        pctBadge.textContent = fmtPct(selectedProfit) + "%";
        pctBadge.classList.add("show");
        profitMenu.classList.remove("open");
        profitBtn.setAttribute("aria-expanded","false");
        document.body.classList.remove("noscroll");
        requestRerender();
      }
    });

    function applyCustomPct(){
      const v = Number(customPct.value);
      if(!isFinite(v) || v < 0){
        showToast("Ingresa un porcentaje válido");
        return;
      }
      selectedProfit = v;
      pctBadge.textContent = fmtPct(v) + "%";
      pctBadge.classList.add("show");
      profitMenu.classList.remove("open");
      profitBtn.setAttribute("aria-expanded","false");
      document.body.classList.remove("noscroll");
      requestRerender();
    }

    applyCustom.addEventListener("click", applyCustomPct);
    customPct.addEventListener("keydown", (e)=>{ if(e.key === "Enter") applyCustomPct(); });

    document.querySelector(".menu .custom").addEventListener("click", (ev)=>ev.stopPropagation());

    document.addEventListener("click", (e)=>{
      if(!profitMenu.classList.contains("open")) return;
      if(!e.target.closest(".popover")){
        profitMenu.classList.remove("open");
        profitBtn.setAttribute("aria-expanded","false");
        document.body.classList.remove("noscroll");
      }
    });

    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape" && profitMenu.classList.contains("open")){
        profitMenu.classList.remove("open");
        profitBtn.setAttribute("aria-expanded","false");
        document.body.classList.remove("noscroll");
      }
      if(e.key === "Escape" && registerModal.classList.contains("open")){
        closeRegisterModal();
      }
      if(e.key === "Escape" && capitalActionModal && capitalActionModal.classList.contains("open")){
        closeCapitalActionModal();
      }
      if(e.key === "Escape" && countryDetailModal && countryDetailModal.classList.contains("open")){
        closeCountryDetailModal();
      }
    });

    closeModalBtn.addEventListener("click", closeRegisterModal);
    cancelModalBtn.addEventListener("click", closeRegisterModal);

    registerModal.addEventListener("click", (e)=>{
      if(e.target === registerModal) closeRegisterModal();
    });

    if(closeCapitalActionModalBtn) closeCapitalActionModalBtn.addEventListener("click", closeCapitalActionModal);
    if(cancelCapitalActionModalBtn) cancelCapitalActionModalBtn.addEventListener("click", closeCapitalActionModal);
    if(capitalActionModal) capitalActionModal.addEventListener("click", (e)=>{
      if(e.target === capitalActionModal) closeCapitalActionModal();
    });
    if(capitalResetMovementsBtn) capitalResetMovementsBtn.addEventListener("click", ()=>applyCapitalCardAction("reset"));
    if(capitalDeleteCardBtn) capitalDeleteCardBtn.addEventListener("click", ()=>applyCapitalCardAction("delete"));

    if(closeCountryDetailModalBtn) closeCountryDetailModalBtn.addEventListener("click", closeCountryDetailModal);
    if(countryDetailModal) countryDetailModal.addEventListener("click", (e)=>{
      if(e.target === countryDetailModal) closeCountryDetailModal();
    });
    if(countryDetailSelect) countryDetailSelect.addEventListener("change", (e)=>{
      const value = e.target?.value || "";
      if(value) renderCountryDetail(value);
    });

    saveOperationBtn.addEventListener("click", savePendingOperation);

    if(saveProfileBtn){
      saveProfileBtn.addEventListener("click", ()=>{
        const data = {
          fullName: profileFullName?.value?.trim() || "",
          phone: profilePhone?.value?.trim() || "",
          residenceCountry: profileResidenceCountry?.value || ""
        };

        if(!data.fullName || !data.phone || !data.residenceCountry){
          onzeAlert("Completa nombre, teléfono y país para guardar tu perfil.");
          return;
        }

        saveProfile(data);
        updateProfileUI();
        onzeAlert("Perfil guardado correctamente.");
        switchView("dashboard");
      });
    }

    if(profileReminderBtn){
      profileReminderBtn.addEventListener("click", ()=>switchView("profile"));
    }

    if(sidebarProfileBtn){
      sidebarProfileBtn.addEventListener("click", ()=>{
        switchView("profile");
      });
    }

    if(openOperatorProfitBtn){
      openOperatorProfitBtn.addEventListener("click", ()=>{
        switchView("operator-profit");
      });
    }

    if(openProviderControlBtn){
      openProviderControlBtn.addEventListener("click", ()=>{
        switchView("provider-control");
        renderProvidersView();
      });
    }

    if(backToDashboardFromProvidersBtn){
      backToDashboardFromProvidersBtn.addEventListener("click", ()=>{
        switchView("dashboard");
      });
    }

    if(providerCountryInput){
  providerCountryInput.addEventListener("change", updateProviderCurrencyFromCountry);
}

if(shareProviderSummaryBtn){
  shareProviderSummaryBtn.addEventListener("click", async ()=>{
    if(!currentProviderSummaryText){
      onzeAlert("No hay resumen para compartir.");
      return;
    }

    try{
      await navigator.clipboard.writeText(currentProviderSummaryText);
      if(typeof showToast === "function"){
        showToast("Resumen copiado para compartir");
      }else{
        onzeAlert("Resumen copiado para compartir.");
      }
    }catch(e){
      onzeAlert(currentProviderSummaryText);
    }
  });
}

if(closeProviderDetailBtn){
  closeProviderDetailBtn.addEventListener("click", ()=>{
    currentProviderDetailId = null;
    currentProviderSummaryText = "";

    if(providerDetailPanel){
      providerDetailPanel.style.display = "none";
    }
  });
}

if(viewProviderPendingBtn){
  viewProviderPendingBtn.addEventListener("click", ()=>{
    switchView("provider-pending");
    renderProviderPendingFullView();
  });
}

if(backToProvidersFromPendingBtn){
  backToProvidersFromPendingBtn.addEventListener("click", ()=>{
    switchView("provider-control");
    renderProvidersView();
  });
}

if(addProviderBtn){
      addProviderBtn.addEventListener("click", ()=>{
        editingProviderId = null;

        if(providerModalTitle) providerModalTitle.textContent = "Agregar proveedor";
        if(providerNameInput) providerNameInput.value = "";
        if(providerCountryInput) providerCountryInput.value = "";
        if(providerCurrencyInput) providerCurrencyInput.value = "";
        if(providerNoteInput) providerNoteInput.value = "";
        if(saveProviderBtn) saveProviderBtn.textContent = "Guardar proveedor";

        if(providerModal){
          providerModal.classList.add("open");
          providerModal.setAttribute("aria-hidden", "false");
        }
      });
    }

    function closeProviderModal(){
      editingProviderId = null;

      if(providerModal){
        providerModal.classList.remove("open");
        providerModal.setAttribute("aria-hidden", "true");
      }
    }

    if(closeProviderModalBtn){
      closeProviderModalBtn.addEventListener("click", closeProviderModal);
    }

    if(cancelProviderModalBtn){
      cancelProviderModalBtn.addEventListener("click", closeProviderModal);
    }

    if(saveProviderBtn){
      saveProviderBtn.addEventListener("click", ()=>{
        const name = providerNameInput ? providerNameInput.value.trim() : "";
        const country = providerCountryInput ? providerCountryInput.value.trim() : "";
        const currency = providerCurrencyInput ? providerCurrencyInput.value.trim().toUpperCase() : "";
        const note = providerNoteInput ? providerNoteInput.value.trim() : "";

        if(!name){
          onzeAlert("Debes ingresar el nombre del proveedor.");
          return;
        }

        if(!country){
          onzeAlert("Debes seleccionar el país del proveedor.");
          return;
        }

        if(!currency){
          onzeAlert("No se pudo cargar la moneda del país seleccionado.");
          return;
        }

        const providers = loadProviders();

        if(editingProviderId){
          const provider = providers.find(p => p.id === editingProviderId);

          if(provider){
            provider.name = name;
            provider.country = country;
            provider.currency = currency;
            provider.note = note;
            provider.updatedAt = new Date().toISOString();
          }
        }else{
          providers.push({
            id: "prov_" + Date.now(),
            name,
            country,
            currency,
            note,
            status: "active",
            createdAt: new Date().toISOString()
          });
        }

        const wasEditingProvider = !!editingProviderId;

        saveProviders(providers);
        renderProvidersView();
        closeProviderModal();

        if(typeof showToast === "function"){
          showToast(wasEditingProvider ? "Proveedor actualizado correctamente" : "Proveedor agregado correctamente");
        }
      });
    }

    if(backToDashboardFromOperatorsBtn){
      backToDashboardFromOperatorsBtn.addEventListener("click", ()=>{
        switchView("dashboard");
      });
    }

    if(operatorProfitFilter){
      operatorProfitFilter.addEventListener("change", ()=>{
        renderOperatorProfit(loadOperations());
      });
    }

    if(operatorProfitDateFrom){
      operatorProfitDateFrom.addEventListener("change", ()=>{
        renderOperatorProfit(loadOperations());
      });
    }

    if(operatorProfitDateTo){
      operatorProfitDateTo.addEventListener("change", ()=>{
        renderOperatorProfit(loadOperations());
      });
    }

    if(resetOperatorProfitFiltersBtn){
      resetOperatorProfitFiltersBtn.addEventListener("click", ()=>{
        if(operatorProfitFilter) operatorProfitFilter.value = "";
        if(operatorProfitDateFrom) operatorProfitDateFrom.value = "";
        if(operatorProfitDateTo) operatorProfitDateTo.value = "";
        renderOperatorProfit(loadOperations());
      });
    }

    document.addEventListener("change", (e)=>{
      if(e.target && e.target.name === "profitConvertChoice"){
        refreshProfitConvertUI();
      }
      if(e.target && e.target.id === "profitConvertTarget"){
        updateProfitConvertPreview();
      }
    });

    clearHistoryBtn.addEventListener("click", async ()=>{
      if(!(await onzeConfirm("¿Seguro que quieres borrar todo el historial?"))) return;

      try{
        const res = await fetch("/api/operations", { method: "DELETE" });
        const data = await res.json().catch(()=>({}));

        if(!res.ok){
          throw new Error(data?.error || "No se pudo borrar el historial");
        }

        const latestOps = await fetchOperationsFromApi();
        saveOperations(latestOps);
        saveProviderMovements([]);
        renderProvidersView();
        if(typeof renderProviderPendingFullView === "function") renderProviderPendingFullView();
        rebuildBalanceMovementsFromOperations((latestOps || []).filter(op => !op.deleted));
        refreshHistoryUI();
        renderInitialCapital();
        refreshDashboard((latestOps || []).filter(op => !op.deleted));
        showToast("Historial borrado");
      }catch(error){
        console.error("CLEAR_HISTORY_ERROR", error);
        showToast(error?.message || "No se pudo borrar el historial");
      }
    });

    document.querySelectorAll(".nav-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const target = btn.getAttribute("data-view-target");
        switchView(target);
      });
    });

    document.querySelectorAll("[data-go-view]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const target = btn.getAttribute("data-go-view");
        switchView(target);
      });
    });

    if(sel){
      sel.addEventListener("change", ()=>{
        try{
          localStorage.setItem("onze_selected_country", sel.value || "");
        }catch{}
      });
    }

    if(destSel){
      destSel.addEventListener("change", ()=>{
        try{
          localStorage.setItem("onze_selected_destination", destSel.value || "");
        }catch{}
      });
    }

    try{
      const savedActiveView = localStorage.getItem("onze_active_view");
      if(savedActiveView){
        switchView(savedActiveView);
      }
    }catch{}


    if(registerOperationBtn){
      registerOperationBtn.addEventListener("click", (e)=>{
        if(!requireProfileForAction("Debes completar tu perfil antes de registrar operaciones.")){
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }

    if(heroRegisterBtn){
      heroRegisterBtn.addEventListener("click", (e)=>{
        if(!requireProfileForAction("Debes completar tu perfil antes de registrar operaciones.")){
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }


    /* ===== WhatsApp stable message builder ===== */
    function buildWhatsappMessageStable(){
      const profile = loadProfile();
      const ops = loadOperations();
      const grouped = new Map();

      ops.forEach(op => {
        const country = op.profitCountry || op.originCountry || "\u2014";
        const currency = op.profitCurrency || getCurrencyFor(country);
        const key = `${country}|${currency}`;
        if(!grouped.has(key)) grouped.set(key, { country, currency, total: 0 });
        grouped.get(key).total += Number(op.profitValue || 0);
      });

      const groups = Array.from(grouped.values()).sort((a,b)=>a.country.localeCompare(b.country,"es",{sensitivity:"base"}));
      const today = new Intl.DateTimeFormat("es-CL", { year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());

      const ICON_CLIP = String.fromCodePoint(0x1F4CB);
      const ICON_DATE = String.fromCodePoint(0x1F4C5);
      const ICON_USER = String.fromCodePoint(0x1F464);
      const ICON_ORDERS = String.fromCodePoint(0x1F9FE);
      const ICON_WORLD = String.fromCodePoint(0x1F30D);
      const ICON_MONEY = String.fromCodePoint(0x1F4B0);

      const lines = [
        `${ICON_CLIP} CIERRE DIARIO ONZE`,
        ``,
        `${ICON_DATE} Fecha: ${today}`,
        `${ICON_USER} Operador: ${profile.fullName || "Operador ONZE"}`,
        `${ICON_ORDERS} Cantidad de \u00f3rdenes: ${ops.length}`,
        ``,
        `${ICON_WORLD} Ganancia por pa\u00eds:`
      ];

      groups.forEach(g => {
        lines.push(`\u2022 ${getFlagEmoji(g.country)} ${g.country}: ${formatCalcValue(g.total, g.currency)} ${g.currency}`);
      });

      lines.push("");
      lines.push(`${ICON_MONEY} Total final a pagar:`);
      groups.forEach(g => {
        lines.push(`\u2022 ${formatCalcValue(g.total, g.currency)} ${g.currency}`);
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
    }

    function ensureDashboardWhatsappButton(){
      const dashSection = document.querySelector("#view-dashboard .section-card");
      if(!dashSection || document.getElementById("dashboardShareBtn")) return;

      const wrap = document.createElement("div");
      wrap.className = "dashboard-share-wrap";
      wrap.innerHTML = '<button type="button" class="dashboard-share-btn" id="dashboardShareBtn"><span class="icon">\uD83D\uDCAC</span><span>Enviar cierre por WhatsApp</span></button>';
      dashSection.appendChild(wrap);

      document.getElementById("dashboardShareBtn").addEventListener("click", ()=>{
        if(!requireProfileForAction("Debes completar tu perfil antes de enviar el cierre por WhatsApp.")) return;

        const ops = (typeof loadOperations === "function") ? loadOperations() : [];
        const hasSocioPayingDest = ops.some(op =>
          op?.operatorMode === "socio" &&
          op?.payerSide === "socio" &&
          Number(op?.partnerPayoutDestCostUsdt || 0) > 0
        );

        const text = hasSocioPayingDest && typeof buildWhatsappMessageSocio === "function"
          ? buildWhatsappMessageSocio()
          : buildWhatsappMessageStable();

        window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      });
    }

    async function syncOperationsUiFromApi(){
      try{
        const latestOps = await fetchOperationsFromApi();
        saveOperations(latestOps);
        syncProviderMovementsFromOperations(latestOps);
        rebuildBalanceMovementsFromOperations((latestOps || []).filter(op => !op.deleted));
        refreshHistoryUI();
        renderInitialCapital();
        refreshDashboard((latestOps || []).filter(op => !op.deleted));
        if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
          renderCountryDetail(pendingCountryDetail);
        }
      }catch(error){
        console.error("SYNC_OPERATIONS_UI_ERROR", error);
      }
    }

    document.addEventListener("DOMContentLoaded", async ()=>{
      applyRoleUIRestrictions();
      fetchAndRender(true);
      await syncOperationsUiFromApi();
      await fetchExpensesFromApi();
      if(IS_ADMIN_ROLE){
        await fetchCapitalFromApi();
      } else {
        saveInitialCapital([]);
      }
      renderExpenses();
      renderInitialCapital();
      refreshDashboard();
      refreshClientSuggestions();
      fillProfileForm();
      operationDate.value = todayISO();
      ensureDashboardWhatsappButton();
    });

    window.addEventListener("focus", ()=>{
      syncOperationsUiFromApi();
    });

    document.addEventListener("visibilitychange", ()=>{
      if(document.visibilityState === "visible"){
        syncOperationsUiFromApi();
      }
    });
