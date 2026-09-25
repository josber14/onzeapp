
/* ===== ONZE: Capacity Externo P2P ===== */
(function(){
  try{
  if(window.__onzeP2PCapacityLoaded) return;
  window.__onzeP2PCapacityLoaded = true;

  // Separadas por tenant (window.__p2pTenantSuffix) -- ver el comentario
  // junto a esa variable, al inicio del panel: estas claves eran globales
  // al origen onze-pay.com y llegaron a mezclar ventas/capacity de dos
  // cuentas distintas en el mismo navegador.
  const CAPACITY_KEY = "onze_p2p_capacity_items" + (window.__p2pTenantSuffix || "");
  const OWN_CAPITAL_KEY = "onze_p2p_own_capital_items" + (window.__p2pTenantSuffix || "");
  const CARRYOVER_KEY = "onze_p2p_capacity_carryover" + (window.__p2pTenantSuffix || "");
  const P2P_MANUAL_MODE_KEY = "__p2pManualMode" + (window.__p2pTenantSuffix || "");
  const P2P_LAST_CLEAR_KEY = "__p2pCapacityLastClear" + (window.__p2pTenantSuffix || "");

  function getP2PCapacityCarryover(id){
    try{
      const all = JSON.parse(localStorage.getItem(CARRYOVER_KEY) || "{}");
      return all[id] || null;
    }catch{ return null; }
  }

  function setP2PCapacityCarryover(id, clp, usdt, commissionUsdt){
    try{
      const all = JSON.parse(localStorage.getItem(CARRYOVER_KEY) || "{}");
      all[id] = { clp, usdt, commissionUsdt };
      localStorage.setItem(CARRYOVER_KEY, JSON.stringify(all));
    }catch(e){ console.warn("Error saving carryover:", e); }
  }

  // Bug real confirmado en vivo (sep 2026): esta función se INVENTABA su
  // propia fecha de inicio la primera vez que corría en CADA navegador (la
  // guardaba en localStorage, P2P_CAPACITY_BASELINE_KEY, y ahí quedaba para
  // siempre). Como localhost, la web de escritorio y el celular son
  // navegadores/perfiles distintos, cada uno terminaba con una fecha de
  // inicio distinta, elegida en un momento distinto -- "Hoy" coincidía entre
  // dispositivos (ninguna fecha de corte cae dentro de las últimas 24h),
  // pero "Este mes" y "Capital P2P" daban números completamente distintos
  // según cuántas ventas del mes quedaban del lado equivocado del corte de
  // CADA dispositivo. Recargar la página no arreglaba nada porque el valor
  // ya estaba guardado localmente, no era un problema de sincronización.
  //
  // Arreglo: usar el mismo corte que ya vive en el servidor
  // (TenantSettings.p2pResetCutoff, el instante del último "Empezar de
  // cero" -- ver /api/p2p/reset) en vez de inventar uno nuevo por
  // dispositivo. syncP2PCapacityFromServer() lo trae en cada sync y lo deja
  // en window.__p2pServerResetCutoff; acá solo se lee. Sin cutoff (nunca se
  // hizo un reset) = sin restricción, cuenta todo el historial real.
  function getP2PCapacityBaselineTs(){
    return Number(window.__p2pServerResetCutoff || 0) || 0;
  }

  function p2pCapMoney(n, decimals = 2){
    const value = Number(n || 0);
    return value.toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function p2pCapNumber(value){
    const raw = String(value || "0").trim().replace(/\./g, "").replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function loadP2POwnCapital(){
    try{
      return JSON.parse(localStorage.getItem(OWN_CAPITAL_KEY) || "[]");
    }catch(e){
      return [];
    }
  }

  function saveP2POwnCapital(items){
    localStorage.setItem(OWN_CAPITAL_KEY, JSON.stringify(Array.isArray(items) ? items : []));
  }

  function getP2POwnCapitalTotalUsdt(){
    return loadP2POwnCapital().reduce((sum, item)=> sum + Number(item.usdtAmount || 0), 0);
  }

  // Cache en memoria sincronizada con la base de datos
  window.__p2pCapacityCache = (() => {
    try { return JSON.parse(localStorage.getItem(CAPACITY_KEY) || "[]"); } catch(e) { return []; }
  })();

  // Items guardados localmente que todavía pueden no haber llegado al servidor.
  window.__p2pCapacityPendingSync = window.__p2pCapacityPendingSync || {};

  window.loadP2PCapacity = function loadP2PCapacity(){
    return Array.isArray(window.__p2pCapacityCache) ? window.__p2pCapacityCache : [];
  };

  function saveP2PCapacity(items){
    const arr = Array.isArray(items) ? items : [];
    window.__p2pCapacityCache = arr;
    window.__p2pCapacityLastSave = Date.now();
    // Bug real confirmado en vivo (sep 2026, causó lentitud/UI trabada para
    // el usuario): con muchos capacitys (cada uno con el detalle completo de
    // sus ventas), el JSON de esta lista puede superar el límite de
    // localStorage del navegador (QuotaExceededError). window.__p2pCapacityCache
    // (arriba) ya se actualizó y es lo que de verdad usa el resto del panel
    // -- localStorage acá es solo una copia para pintar rápido en la
    // PRÓXIMA carga, nunca debe poder tirar abajo la acción actual del
    // usuario si falla.
    try{ localStorage.setItem(CAPACITY_KEY, JSON.stringify(arr)); }catch(e){ console.warn('No se pudo guardar capacity en localStorage (no crítico):', e.message); }
  }

  // Ventas manuales (Bybit/OKX sin API conectada, o correcciones manuales de
  // Binance) -- antes solo vivían en localStorage, ver P2PManualSale en
  // prisma/schema.prisma. Mismo patrón fire-and-forget con reintentos que
  // postP2PCapacityToServer, para no bloquear la UI si el servidor tarda.
  // window.-scoped a propósito -- este archivo tiene varios <script> con su
  // propio scope (ver comentario de IIFE scoping más abajo en socioBn*), así
  // que una función local aquí no sería visible desde deleteManualSale (que
  // vive en OTRO bloque <script>) y rompería silenciosamente el borrado.
  window.postP2PManualSaleToServer = function postP2PManualSaleToServer(item, attempt){
    attempt = attempt || 0;
    fetch('/api/p2p/manual-sale', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item })
    })
    .then(async res => {
      const data = await res.json().catch(()=>null);
      if(!res.ok || !data?.ok) throw new Error(data?.error || res.statusText || "Error servidor");
    })
    .catch(e => {
      console.warn('Error guardando venta manual (intento '+(attempt+1)+'):', e.message);
      if(attempt < 2) setTimeout(function(){ postP2PManualSaleToServer(item, attempt+1); }, 2000);
      else if(typeof showToast === "function") showToast("⚠️ No se pudo guardar la venta manual en servidor");
    });
  }

  window.deleteP2PManualSaleFromServer = function deleteP2PManualSaleFromServer(id){
    fetch('/api/p2p/manual-sale?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' })
      .catch(e => console.warn('Error borrando venta manual en servidor:', e.message));
  }

  // Trae las ventas manuales guardadas en Neon y las mezcla con lo que ya
  // hay en localStorage (dedup por orderNumber) -- así una venta manual
  // cargada desde OTRO navegador/dispositivo también aparece acá, y no se
  // pierde nada si se limpia el caché local.
  window.syncP2PManualSalesFromServer = async function syncP2PManualSalesFromServer(){
    try {
      const res = await fetch('/api/p2p/manual-sale', { credentials: 'include' });
      if(!res.ok) return false;
      const data = await res.json();
      if(!data?.ok || !Array.isArray(data.orders)) return false;

      const byExchange = { binance: [], bybit: [], okx: [] };
      for(const o of data.orders){
        const ex = (o.exchange === "bybit" || o.exchange === "okx") ? o.exchange : "binance";
        byExchange[ex].push(o);
      }

      function mergeInto(loadFn, saveFn, serverOrders){
        if(!serverOrders.length) return false;
        const existing = loadFn();
        const seen = new Set(existing.map(o => o.orderNumber));
        let changed = false;
        for(const o of serverOrders){
          if(!seen.has(o.orderNumber)){
            existing.push(o);
            seen.add(o.orderNumber);
            changed = true;
          }
        }
        if(changed) saveFn(existing);
        return changed;
      }

      const anyChanged = [
        mergeInto(loadP2PBinanceOrders, saveP2PBinanceOrders, byExchange.binance),
        mergeInto(loadP2PBybitOrders, saveP2PBybitOrders, byExchange.bybit),
        mergeInto(loadP2POkxOrders, saveP2POkxOrders, byExchange.okx),
      ].some(Boolean);

      // Si trajo algo nuevo (ej. cargado desde otro dispositivo), refrescar
      // las vistas que dependen de estas ventas -- si no, quedarían
      // desactualizadas hasta el próximo sync no relacionado.
      if(anyChanged){
        if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
        if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
        if(typeof renderP2PDashboardFromOkx === 'function') renderP2PDashboardFromOkx();
        if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
        if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
      }
      return true;
    } catch(e) {
      console.warn('Error sincronizando ventas manuales:', e.message);
      return false;
    }
  };

  // Map orderNumber -> CLP marcado como "capital propio" -- ver
  // P2PCapitalMarkedSale y el filtro en calculateP2PCapacityStats(). Se
  // sincroniza desde el servidor (no localStorage) para que la marca sea
  // igual en cualquier dispositivo.
  //
  // Bug real confirmado en vivo (sep 2026): la primera versión usaba un Set
  // (solo orderNumber, sin monto) y EXCLUÍA la venta COMPLETA del reparto.
  // Una venta grande parcialmente cubierta por un capacity real (ej. 80%
  // asignado, 20% sin asignar) perdía el 100% de golpe al marcar el 20% --
  // le robaba al capacity real la parte que sí le correspondía (~44M CLP en
  // una cuenta, ~14.7M CLP en otra). Ahora se guarda el MONTO marcado y se
  // usa como un bloqueo parcial (lockedByOrder), igual que las ventas ya
  // cubiertas por un capacity finalizado -- ver calculateP2PCapacityStats().
  window.__p2pCapitalMarkedOrderNumbers = window.__p2pCapitalMarkedOrderNumbers || new Map();

  // Bug real confirmado en vivo (sep 2026, plata real afectada -- ver
  // AGENTS.md): autoFinishP2PCapacities() podía correr y ESCRIBIR en Neon
  // ANTES de que esta sincronización terminara la primera vez -- el Map de
  // arriba empieza vacío, así que un capacity nuevo recién creado se
  // completaba usando ventas que en realidad ya estaban marcadas como
  // "capital propio", quedando FROZEN con esa plata duplicada para siempre
  // (17.000.000 CLP en un caso real). Este flag se pone en true recién
  // cuando el servidor contestó AL MENOS UNA VEZ -- autoFinishP2PCapacities()
  // se niega a actuar mientras siga en false, sin importar cuántas veces se
  // llame mientras tanto.
  window.__p2pCapitalMarkedSalesLoaded = window.__p2pCapitalMarkedSalesLoaded || false;

  window.syncP2PCapitalMarkedSalesFromServer = async function syncP2PCapitalMarkedSalesFromServer(){
    try {
      const res = await fetch('/api/p2p/capital-marked-sale', { credentials: 'include' });
      if(!res.ok) return false;
      const data = await res.json();
      if(!data?.ok || !Array.isArray(data.items)) return false;

      const next = new Map(data.items.map(it => [String(it.orderNumber || ""), Number(it.totalPrice || 0)]));
      let changed = next.size !== window.__p2pCapitalMarkedOrderNumbers.size;
      if(!changed){
        for(const [id, clp] of next){ if(window.__p2pCapitalMarkedOrderNumbers.get(id) !== clp){ changed = true; break; } }
      }
      window.__p2pCapitalMarkedOrderNumbers = next;
      window.__p2pCapitalMarkedSalesLoaded = true;

      if(changed){
        if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
        if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
      }
      return true;
    } catch(e) {
      console.warn('Error sincronizando ventas marcadas como capital propio:', e.message);
      return false;
    }
  };

  function postP2PCapacityToServer(item, onSuccess, opts){
    // manualAction=true identifica un cierre EXPLÍCITO del usuario (botón
    // "Completar capacity", ver finishCapacityManually) -- distinto del
    // cierre AUTOMÁTICO y silencioso de autoFinishP2PCapacities(). El motor
    // del servidor (ver AGENTS.md, "Motor de Capacity del lado del
    // servidor") solo bloquea el segundo cuando una cuenta ya está en modo
    // autoritativo; la acción deliberada del usuario siempre se respeta.
    const manualAction = !!(opts && opts.manualAction);
    (function retry(item, attempt){
      fetch('/api/p2p/capacity?confirm=manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, manualAction })
      })
      .then(async res => {
        const data = await res.json().catch(()=>null);
        if(!res.ok || !data?.ok){
          throw new Error(data?.error || res.statusText || "Error servidor");
        }
        if(typeof onSuccess === 'function') onSuccess(item);
      })
      .catch(e => {
        console.warn('Error sync capacity (intento '+(attempt+1)+'):', e.message);
        if(attempt < 2){
          setTimeout(function(){ retry(item, attempt+1); }, 2000);
        } else {
          if(typeof showToast === "function") showToast("⚠️ No se pudo guardar capacity en servidor");
        }
      });
    })(item, 0);
  }

  window.syncP2PCapacityFromServer = async function syncP2PCapacityFromServer(){
    try {

      // Bloqueo defensivo: no sincronizar si hubo un guardado local reciente.
      // Evita que el server devuelva una lista vieja y desaparezca un capacity recién creado.
      const lastSave = Number(window.__p2pCapacityLastSave || 0);
      if (lastSave && (Date.now() - lastSave) < 12000) {
        console.log("⏸️ Sync pospuesto: guardado local reciente");
        return false;
      }

      const res = await fetch('/api/p2p/capacity', { credentials: 'include' });
      if (!res.ok) {
        // Bug real confirmado en vivo (sep 2026): un 500 acá (ej. servidor de
        // desarrollo con el cliente de Prisma desactualizado tras un cambio
        // de esquema, sin reiniciar) quedaba en absoluto silencio -- el panel
        // seguía mostrando "0 capacitys" para siempre, indistinguible de una
        // cuenta que de verdad no tiene ninguno cargado. Un 401 (sesión
        // vencida) es normal y no necesita alarmar -- cualquier OTRO código
        // sí es una falla real que hay que hacer visible.
        if (res.status !== 401) {
          warnP2PCapacitySyncFailure(`servidor respondió ${res.status}`);
        }
        return false;
      }
      const data = await res.json();
      window.__p2pServerAuthority = !!data?.serverAuthority;
      // Ver getP2PCapacityBaselineTs() -- fecha de inicio ÚNICA para todos
      // los dispositivos, en vez de que cada navegador se invente la suya.
      window.__p2pServerResetCutoff = Number(data?.resetCutoff || 0) || 0;
      if (data?.ok && Array.isArray(data.items)) {
        // Siempre que el usuario haya indicado limpieza manual (flag persistente),
        // ignorar datos del servidor y borrar registros remotos para que no resuciten.
        // El flag se activa con la función window.deleteAllP2PCapacities().
        const p2pManualMode = localStorage.getItem(P2P_MANUAL_MODE_KEY) === 'true';
        const lastClear = Number(window.__p2pCapacityLastClear || localStorage.getItem(P2P_LAST_CLEAR_KEY) || 0);
        const recentlyCleared = lastClear && (Date.now() - lastClear) < 60000;

        const clearAge = lastClear ? Date.now() - lastClear : Infinity;

        // Si el modo manual está activo pero ya pasaron 60s desde el último clear,
        // ignorarlo (la bandera quedó colgada de un reset anterior).
        if(p2pManualMode && !recentlyCleared && clearAge > 60000){
          localStorage.removeItem(P2P_MANUAL_MODE_KEY);
          console.log("✅ Modo manual P2P desactivado — ya expiró");
        }

        if(p2pManualMode || recentlyCleared){
          if(data.items.length > 0 && recentlyCleared){
            for(const item of data.items){
              // Solo borrar items que existían antes del clear (no los creados después)
              const itemCreatedAt = new Date(item.createdAt || 0).getTime();
              if(itemCreatedAt < lastClear || lastClear === 0){
                fetch('/api/p2p/capacity?id=' + encodeURIComponent(item.id) + '&confirm=manual', { method:'DELETE', credentials:'include' })
                  .catch(() => {});
              }
            }
          }
          if(p2pManualMode && recentlyCleared){
            console.log("🧹 Modo manual P2P activo — limpiando registros del servidor cada sync");
          }
          // Si el servidor ya está vacío O pasaron 60s, desactivar modo manual
          if(data.items.length === 0 || (clearAge > 60000)){
            localStorage.removeItem(P2P_MANUAL_MODE_KEY);
            if(p2pManualMode) console.log("✅ Modo manual P2P desactivado — servidor limpio");
          }
          return false;
        }
        const previous = window.__p2pCapacityCache || [];
        const serverItems = data.items;
        const previousLocalItems = Array.isArray(window.__p2pCapacityCache) ? window.__p2pCapacityCache : [];

        const serverIds = new Set(serverItems.map(item => item.id));
        const now = Date.now();

        // Confirmar pendientes solo cuando el servidor los devuelve en GET.
        Object.keys(window.__p2pCapacityPendingSync || {}).forEach(id => {
          if(serverIds.has(id)){
            delete window.__p2pCapacityPendingSync[id];
          }
        });

        // Si hay items pendientes de guardar que todavía no aparecen en servidor,
        // mantenerlos en pantalla para que no desaparezcan por un sync viejo.
        const protectedLocalItems = Object.values(window.__p2pCapacityPendingSync || {})
          .filter(entry => entry?.item?.id && !serverIds.has(entry.item.id) && (now - Number(entry.savedAt || 0)) < 10 * 60 * 1000)
          .map(entry => entry.item);

        // Preservar valores runtime locales (usedUsdt, clpReceived, saleParts)
        // que el servidor NO persiste, para que no se pierdan al sincronizar.
        const localCache = window.__p2pCapacityCache;
        const localById = {};
        if(Array.isArray(localCache)){
          localCache.forEach(l => { if(l?.id) localById[l.id] = l; });
        }

        // Preservar items locales que no están en el servidor SOLO si:
        // 1. Están en pending sync (aún no se han guardado en el servidor), O
        // 2. Hubo un guardado local reciente (< 5 min) — evita que una falla
        //    temporal del servidor borre capacities legítimos.
        // Items que no cumplen ninguna condición (ni pending, ni save reciente)
        // se consideran borrados intencionalmente del servidor y NO se resucitan.
        const pendingIds = new Set(Object.keys(window.__p2pCapacityPendingSync || {}));
        const lastSave = Number(window.__p2pCapacityLastSave || 0);
        const recentlySaved = lastSave && (Date.now() - lastSave) < 300000;
        if(Array.isArray(localCache)){
          localCache.forEach(localItem => {
            if(localItem?.id && !serverIds.has(localItem.id)){
              const keep = pendingIds.has(localItem.id) || recentlySaved;
              if(keep && !protectedLocalItems.find(p => p.id === localItem.id)){
                protectedLocalItems.push(localItem);
              }
            }
          });
        }

          // Neon es la unica fuente de verdad. Solo sobreescribimos campos persistidos
          // cuando hay un guardado local reciente (<5min) para evitar race conditions.
          const recentLocalSave = window.__p2pCapacityLastSave && (Date.now() - window.__p2pCapacityLastSave) < 300000;
          const mergedServerItems = serverItems.map(srv => {
            const local = localById[srv.id];
            const base = {
              ...srv,
              saleParts: Array.isArray(srv.finalSaleParts) ? srv.finalSaleParts : [],
            };
            if (!local) return base;
            if (!recentLocalSave) return base;
            // Solo capacityClp y manualPaymentsClp se persisten en el servidor.
            // Los campos runtime (usedUsdt, clpReceived, etc.) los recalcula calculateP2PCapacityStats().
            return {
              ...base,
              capacityClp: Number(local.capacityClp || 0),
              manualPaymentsClp: Number(local.manualPaymentsClp || 0),
              manualPaymentClp: Number(local.manualPaymentClp || 0),
            };
          });

        // Filtrar registros especiales de capital inicial que no deben mostrarse como capacities
        const filteredServer = mergedServerItems.filter(c => c.status !== "_capital");
        const filteredLocal = protectedLocalItems.filter(c => c.status !== "_capital");
        const mergedItems = [...filteredServer, ...filteredLocal];

        const changed = JSON.stringify(previous) !== JSON.stringify(mergedItems);
        window.__p2pCapacityCache = mergedItems;
        // Ver el mismo comentario en saveP2PCapacity() -- si esto tira
        // (localStorage lleno), NO puede impedir que el panel se repinte con
        // los datos frescos que ya llegaron del servidor.
        try{ localStorage.setItem(CAPACITY_KEY, JSON.stringify(mergedItems)); }catch(e){ console.warn('No se pudo guardar capacity en localStorage (no crítico):', e.message); }
        if (changed) {
          if (typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
          if (typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        }
        return true;
      }
    } catch(e) {
      console.warn('Error sync from server:', e);
      warnP2PCapacitySyncFailure(e?.message || 'error de red');
    }
    return false;
  };

  // Aviso visible de que los capacitys NO se pudieron cargar del servidor --
  // antes esto fallaba en silencio (ver comentario arriba). Con cooldown de
  // 60s para no repetir el mismo toast en cada intento del timer/reintentos.
  let __p2pCapacitySyncFailureLastWarnedAt = 0;
  function warnP2PCapacitySyncFailure(detail){
    const now = Date.now();
    if (now - __p2pCapacitySyncFailureLastWarnedAt < 60000) return;
    __p2pCapacitySyncFailureLastWarnedAt = now;
    console.error('❌ No se pudieron cargar los capacitys del servidor:', detail);
    if (typeof showToast === 'function') {
      showToast('⚠️ No se pudo cargar Capacity del servidor (' + detail + ') -- los números de esta pantalla pueden estar incompletos. Reintentando...', 'error');
    }
  }

  // SINGLE definition (duplicates removed)
  window.isTodayChileFromTs = function isTodayChileFromTs(ts){
    if(!ts) return false;

    const todayCL = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const orderDayCL = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(Number(ts)));

    return orderDayCL === todayCL;
  }

  window.getOrderTs = function getOrderTs(o){
    if(o?.createTime) return Number(o.createTime);
    if(o?.createdAt) return new Date(o.createdAt).getTime();
    return 0;
  }

  window.isCompletedSellClp = function isCompletedSellClp(o){
    const status = String(o.orderStatus || "").toUpperCase();
    const type = String(o.tradeType || "").toUpperCase();
    const fiat = String(o.fiat || "").toUpperCase();

    return status === "COMPLETED" && type === "SELL" && fiat === "CLP";
  }

  window.loadP2PBinanceSales = function loadP2PBinanceSales(){
    let orders = [];
    try{
      orders = JSON.parse(localStorage.getItem(window.p2pOrdersKey("onze_p2p_binance_orders")) || "[]");
    }catch(e){}

    return orders
      .filter(o => isCompletedSellClp(o) && isTodayChileFromTs(getOrderTs(o)))
      .sort((a,b)=> getOrderTs(a) - getOrderTs(b));
  }

  window.calculateP2PCapacityStats = function calculateP2PCapacityStats(){

    // Bug real confirmado en vivo (sep 2026): dos capacities creados el
    // MISMO día ordenaban solo por "date" (día calendario, sin hora) -- al
    // empatar, el orden entre ellos quedaba según como estuvieran guardados
    // en la memoria del navegador, no según cuál se creó primero de
    // verdad. Un capacity creado unos segundos DESPUÉS podía terminar
    // "colándose" y recibiendo ventas reales que le correspondían al más
    // viejo, dejándolo con un hueco que solo se notaba al intentar
    // completarlo. Ahora, si el día es el mismo, se desempata por el
    // momento EXACTO de creación (createdAt, con hora) -- el capacity
    // creado primero sigue siendo el primero en recibir ventas.
    const capacitiesRaw = loadP2PCapacity()
      .filter(c => c.status !== "_capital")
      .sort((a,b)=> {
        const dateA = new Date(a.date || a.createdAt || 0).getTime();
        const dateB = new Date(b.date || b.createdAt || 0).getTime();
        if(dateA !== dateB) return dateA - dateB;
        const createdA = new Date(a.createdAt || 0).getTime();
        const createdB = new Date(b.createdAt || 0).getTime();
        return createdA - createdB;
      });

    const p2pCapacityBaselineTs = getP2PCapacityBaselineTs();

    // Ventas de Binance, Bybit y OKX se mezclan en una sola lista ordenada
    // por fecha real antes de repartirlas entre los capacity -- así un
    // capacity se descuenta en el orden correcto sin importar de qué
    // exchange vino cada venta. Cada venta queda marcada con "exchange"
    // (por defecto "binance" para ventas ya guardadas antes de este
    // cambio), lo que permite separar Binance/Bybit/OKX después en las
    // tarjetas del resumen. La comisión de Bybit y OKX siempre es 0 desde
    // su propio origen (ver /api/bybit/p2p-history y el formulario de venta
    // manual) -- no hace falta ninguna lógica especial acá, el mismo
    // cálculo de abajo ya la trata como cualquier otra venta con comisión 0.
    const sales = [
      ...loadP2PBinanceOrders().map(o => ({ ...o, exchange: o.exchange || "binance" })),
      ...loadP2PBybitOrders().map(o => ({ ...o, exchange: "bybit" })),
      ...loadP2POkxOrders().map(o => ({ ...o, exchange: "okx" })),
    ]
      .filter(o => isCompletedSellClp(o))
      // Descartar registros fantasma (0 USDT / 0 CLP) -- no son ventas
      // reales, son residuos de caché del navegador de antes del último
      // reinicio del módulo P2P (confirmado ago 2026: una orden así no
      // existe ni siquiera en la base de datos del servidor). Sin este
      // filtro, aparecían para siempre en "Ventas sin compra/capacity
      // detectadas" sin ningún capacity que pudiera "cubrirlas" (0 no se
      // puede cubrir con nada) y sin aportar ningún valor real.
      .filter(o => !window.isP2POrderPhantom(o))
      .filter(o => {
        const saleTs = Number(getOrderTs(o) || 0);

        // Desde este punto ONZE empieza en 0 para el módulo capacity.
        // No se toman ventas anteriores al inicio/reinicio P2P.
        if(!p2pCapacityBaselineTs) return true;
        if(!saleTs) return false;

        return saleTs >= p2pCapacityBaselineTs;
      })
      .sort((a,b)=> Number(getOrderTs(a) || 0) - Number(getOrderTs(b) || 0));

    const capacities = capacitiesRaw.map(item => {
      const price = Number(item.buyPrice || 0);
      const capacityClp = Number(item.capacityClp || 0);
      const legacyUsdt = Number(item.usdtAmount || 0);
      const usdt = capacityClp > 0 && price > 0 ? capacityClp / price : legacyUsdt;
      const totalCost = capacityClp > 0 ? capacityClp : usdt * price;

      const normalizedStatus = String(item.status || "active").trim().toLowerCase();
      const isFinished = normalizedStatus === "finished";

      return {
        ...item,
        status: normalizedStatus || "active",
        usdtAmount: usdt,
        totalCost,
        usedUsdt: isFinished ? Number(item.finalSoldUsdt || 0) : Number(item.usedUsdt || 0),
        clpReceived: isFinished ? Number(item.finalClpReceived || 0) : Number(item.clpReceived || 0),
        commissionUsdt: isFinished ? Number(item.finalCommissionUsdt || 0) : Number(item.commissionUsdt || 0),
        commissionClp: isFinished ? Number(item.finalCommissionClp || 0) : Number(item.commissionClp || 0),
        saleParts: isFinished && Array.isArray(item.finalSaleParts) ? [...item.finalSaleParts] : (Array.isArray(item.saleParts) ? [...item.saleParts] : [])
      };
    });

    // Bloquear ventas ya asignadas a CUALQUIER capacity (activo o finalizado)
    // para evitar doble conteo entre días.
    const lockedByOrder = {};
    capacities.forEach(cap => {
      (cap.saleParts || []).forEach(part => {
        const key = String(part.orderNumber || "");
        if(!key) return;
        lockedByOrder[key] = (lockedByOrder[key] || 0) + Number(part.assignedClp || 0);
      });
      // Capacitys "aligerados" (terminados hace más de un mes -- ver
      // /api/p2p/capacity y AGENTS.md) ya no traen saleParts completo, pero
      // sí traen lockedOrders: la misma info mínima (orden + monto) que esta
      // protección necesita, para que un capacity viejo nunca deje de
      // "reservar" sus ventas aunque ya no se mande el detalle fino.
      (cap.lockedOrders || []).forEach(lo => {
        const key = String(lo.orderNumber || "");
        if(!key) return;
        lockedByOrder[key] = (lockedByOrder[key] || 0) + Number(lo.assignedClp || 0);
      });
    });

    // Ventas marcadas como "capital propio" (botón del aviso "Ventas sin
    // compra/capacity detectadas") -- el usuario ya decidió que ESA PORCIÓN
    // puntual no es ganancia P2P nueva. Se bloquea igual que una venta ya
    // cubierta por un capacity finalizado (mismo mecanismo, arriba) -- NO se
    // excluye la venta completa, solo el monto puntual marcado, para no
    // robarle a un capacity real la parte que sí le corresponde si la venta
    // estaba parcialmente asignada.
    (window.__p2pCapitalMarkedOrderNumbers || new Map()).forEach((clp, orderNumber) => {
      lockedByOrder[orderNumber] = (lockedByOrder[orderNumber] || 0) + Number(clp || 0);
    });

    let unassignedSaleUsdt = 0;
    let unassignedSaleClp = 0;
    let unassignedCommissionUsdt = 0;
    // Detalle de qué venta(s) puntuales quedan sin compra/capacity -- antes
    // el aviso solo mostraba el total, sin forma de saber a qué orden real
    // correspondía (o si de verdad hay una orden real detrás del monto).
    const unassignedSaleDetail = [];

    for(const sale of sales){
      const saleTotalUsdt = Number(sale.amount || 0);
      const saleTotalClp = Number(sale.totalPrice || 0);
      const saleUnitPrice = Number(sale.unitPrice || 0);
      const saleCommissionUsdt = Number(sale.commission || 0);
      const saleOrder = String(sale.orderNumber || "");

      const lockedClp = saleOrder ? Number(lockedByOrder[saleOrder] || 0) : 0;
      let saleRemainingClp = Math.max(saleTotalClp - lockedClp, 0);

      if(saleRemainingClp <= 0) continue;

      for(const cap of capacities){
        if(saleRemainingClp <= 0) break;

        // Capacity finalizado queda congelado. Las nuevas ventas saltan al siguiente activo.
        if(cap.status === "finished") continue;

        // Bug real confirmado en vivo (sep 2026, pedido explícito del
        // usuario): ANTES, un capacity activo solo podía tomar ventas
        // fechadas desde su propia fecha en adelante (capStartTs). Eso
        // rompía el flujo de trabajo real del usuario: cierra el último
        // capacity del día pagando el resto con plata externa (queda
        // "finished", congelado) y al día siguiente crea capacitys nuevos
        // fechados ese día. Cualquier venta real que entrara en el hueco
        // entre esos dos momentos (ej. una venta de anoche tarde, procesada
        // recién esta mañana) no podía ser tomada por NINGÚN capacity: los
        // de ayer ya están congelados, y el de hoy tiene fecha de hoy -- la
        // venta quedaba "en el aire" para siempre, aunque el usuario
        // religiosamente creara un capacity nuevo cada día. Regla de negocio
        // confirmada: una venta sin asignar SOLO es válida si no existe
        // NINGÚN capacity activo en ese momento -- mientras exista al menos
        // uno, tiene que poder cubrirla, sin importar qué fecha tenga
        // escrita. Se quita la restricción de fecha acá: el reparto ahora
        // es FIFO puro por orden de capacity y de venta, no por coincidencia
        // de fechas.

        // Asignar por CLP: el capacity se completa cuando el CLP recibido
        // alcanza su capacityClp. El USDT se prorratea de la venta original.
        // Pedido explícito del usuario (ago 2026): "Completar saldo" (pago
        // manual directo al proveedor, ej. plata enviada para tener USDT sin
        // pasar por una venta de Binance) NO debe reducir el monto total del
        // capacity -- eso hacía que las ventas ya asignadas antes del pago
        // manual se recalcularan contra un monto más chico y descuadraran.
        // manualPaymentsClp se resta acá, del lado de las ventas, junto con
        // lo ya vendido -- así ambas formas de "pagarle al proveedor" (venta
        // real + pago manual) compiten por el mismo monto total fijo, sin
        // pisarse.
        const capTotalClp = Number(cap.capacityClp || 0);
        const capManualPaid = Number(cap.manualPaymentsClp || 0);
        const capUsedClp = Number(cap.clpReceived || 0);
        const capAvailableClp = Math.max(capTotalClp - capManualPaid - capUsedClp, 0);

        if(capAvailableClp <= 0) continue;

        const assignedClp = Math.min(capAvailableClp, saleRemainingClp);
        const ratio = saleTotalClp > 0 ? assignedClp / saleTotalClp : 0;

        const assignedUsdt = saleTotalUsdt * ratio;
        const assignedCommissionUsdt = saleCommissionUsdt * ratio;
        const assignedCommissionClp = assignedCommissionUsdt * (saleUnitPrice || 0);

        cap.usedUsdt += assignedUsdt;
        cap.clpReceived += assignedClp;
        cap.commissionUsdt += assignedCommissionUsdt;
        cap.commissionClp += assignedCommissionClp;

        cap.saleParts.push({
          orderNumber: sale.orderNumber,
          exchange: sale.exchange || "binance",
          assignedUsdt,
          assignedClp,
          unitPrice: saleUnitPrice,
          commissionUsdt: assignedCommissionUsdt,
          createdAt: sale.createdAt,
          originalSaleUsdt: saleTotalUsdt,
          buyPrice: Number(cap.buyPrice || 0)
        });

        saleRemainingClp -= assignedClp;
      }

      if(saleRemainingClp > 0){
        const remainingRatio = saleTotalClp > 0 ? saleRemainingClp / saleTotalClp : 0;
        const remainingUsdt = saleTotalUsdt * remainingRatio;
        // Bug real confirmado en vivo (sep 2026): una venta REAL (ej.
        // $1.000.000 CLP) repartida entre varios capacity puede dejar un
        // resto microscópico (< 1 peso / < 0.005 USDT) por puro redondeo al
        // prorratear -- NO es que la venta le falte comprarla, ya está
        // prácticamente 100% cubierta. Antes esto se mostraba igual como
        // "venta sin asignar" con "0,00 USDT / 0 CLP", y el botón de
        // borrar -- pensado solo para basura de verdad (venta 0/0 desde su
        // origen) -- terminaba borrando la venta REAL completa del caché
        // local. Como la venta sigue existiendo en el servidor, el
        // resincronizado automático (cada 15s) la traía de vuelta sola, así
        // que "eliminar" nunca se sentía como que hacía algo. Ahora este
        // resto de redondeo se ignora directo (no cuenta como pendiente,
        // no aparece en la lista) en vez de pedirle acción al usuario por
        // algo que ya está resuelto.
        if(window.isP2POrderPhantom({ amount: remainingUsdt, totalPrice: saleRemainingClp })) continue;
        unassignedSaleUsdt += remainingUsdt;
        unassignedSaleClp += saleRemainingClp;
        unassignedCommissionUsdt += saleCommissionUsdt * remainingRatio;
        unassignedSaleDetail.push({
          orderNumber: sale.orderNumber || "",
          exchange: sale.exchange || "binance",
          isManual: !!(sale._manual || String(sale.orderNumber || "").startsWith("manual_")),
          clp: saleRemainingClp,
          usdt: remainingUsdt,
          date: sale.createdAt || null,
          ts: Number(getOrderTs(sale) || 0),
        });
      }
    }

    let totalCapacityUsdt = 0;
    let totalCapacityCostClp = 0;
    let totalPaidClp = 0;
    let usedCostClp = 0;
    let allocatedClpReceived = 0;
    let smartReceivedUsdt = 0;
    let smartRemainingUsdt = 0;
    let smartCoveredClp = 0;
    let allocatedCommissionUsdt = 0;
    let allocatedCommissionClp = 0;

    const enriched = capacities.map(item => {
      const price = Number(item.buyPrice || 0);
      // paidClp se registra al crear el capacity. manualPaymentsClp se
      // registra al completar saldo parcial (pago directo al proveedor,
      // fuera de Binance). Pedido explícito del usuario (ago 2026): ya NO
      // reduce el capacityClp (ver el loop de asignación más arriba) --
      // ambos se suman acá como "ya pagado al proveedor por fuera de la
      // venta", junto con lo vendido real, contra el mismo monto total fijo.
      const paid = Number(item.paidClp || 0) + Number(item.manualPaymentsClp || 0);

      // Carryover de días anteriores (ventas pre-cargadas manualmente)
      const carryover = getP2PCapacityCarryover(item.id);
      const carryoverClp = carryover ? Number(carryover.clp || 0) : 0;
      const carryoverUsdt = carryover ? Number(carryover.usdt || 0) : 0;
      const carryoverCommissionUsdt = carryover ? Number(carryover.commissionUsdt || 0) : 0;

      const usedUsdt = Number(item.usedUsdt || 0) + carryoverUsdt;
      const usedCost = usedUsdt * price;

      // Totales inteligentes del capacity:
      // CLP recibido por ventas + saldo completado manualmente = parte del capacity ya cubierta/liberada.
      const capTotalClp = Number(item.totalCost || item.capacityClp || 0);
      const capTotalUsdt = Number(item.usdtAmount || 0);
      const clpReceivedForCap = Number(item.clpReceived || 0) + carryoverClp;
      const coveredClp = Math.min(capTotalClp, Math.max(0, clpReceivedForCap + paid));
      const receivedUsdt = price > 0
        ? Math.min(capTotalUsdt, coveredClp / price)
        : Math.min(capTotalUsdt, usedUsdt);

      const remainingUsdt = Math.max(capTotalUsdt - receivedUsdt, 0);
      const pendingClp = Math.max(capTotalClp - coveredClp, 0);
      const profitClp = clpReceivedForCap - usedCost - Number(item.commissionClp || 0) - carryoverCommissionUsdt * price;
      const avgSellPriceCap = Number(item.usedUsdt || 0) > 0 ? Number(item.clpReceived || 0) / Number(item.usedUsdt || 0) : 0;
      const profitUsdt = avgSellPriceCap > 0 ? profitClp / avgSellPriceCap : 0;
      const commissionPct = Number(item.usedUsdt || 0) > 0 ? (Number(item.commissionUsdt || 0) / Number(item.usedUsdt || 0)) * 100 : 0;
      const profitPct = usedCost > 0 ? (profitClp / usedCost) * 100 : 0;

      // Solo sumar capacities activos (no completados) en los totales globales
      if(item.status !== "finished"){
        totalCapacityUsdt += Number(item.usdtAmount || 0);
        totalCapacityCostClp += Number(item.totalCost || item.capacityClp || 0);
        totalPaidClp += paid;

        smartReceivedUsdt += receivedUsdt;
        smartRemainingUsdt += remainingUsdt;
        smartCoveredClp += coveredClp;
      }
      usedCostClp += usedCost;
      allocatedClpReceived += clpReceivedForCap;
      allocatedCommissionUsdt += Number(item.commissionUsdt || 0) + carryoverCommissionUsdt;
      allocatedCommissionClp += Number(item.commissionClp || 0) + carryoverCommissionUsdt * price;

      return {
        ...item,
        usedCost,
        usedUsdt,
        clpReceived: clpReceivedForCap,
        commissionUsdt: Number(item.commissionUsdt || 0) + carryoverCommissionUsdt,
        commissionClp: Number(item.commissionClp || 0) + carryoverCommissionUsdt * price,
        remainingUsdt,
        pendingClp,
        profitClp,
        profitUsdt,
        avgSellPriceCap,
        commissionPct,
        profitPct
      };
    });

    const totalUsdtSold = sales.reduce((sum, o)=> sum + Number(o.amount || 0), 0);
    const totalClpReceived = sales.reduce((sum, o)=> sum + Number(o.totalPrice || 0), 0);
    const totalCommissionUsdt = sales.reduce((sum, o)=> sum + Number(o.commission || 0), 0);
    const avgSellPrice = totalUsdtSold > 0 ? totalClpReceived / totalUsdtSold : 0;

    const realProfitClp = allocatedClpReceived - usedCostClp - allocatedCommissionClp;
    const realProfitUsdt = avgSellPrice > 0 ? realProfitClp / avgSellPrice : 0;
    const profitPct = usedCostClp > 0 ? (realProfitClp / usedCostClp) * 100 : 0;

    return {
      capacities: enriched,
      totalUsdtSold,
      totalClpReceived,
      totalCommissionUsdt,
      avgSellPrice,
      totalCapacityUsdt,
      totalCapacityCostClp,
      totalPaidClp,
      usedCostClp,
      allocatedClpReceived,
      allocatedCommissionUsdt,
      allocatedCommissionClp,
      realProfitClp,
      realProfitUsdt,
      profitPct,
      // Métricas inteligentes del panel de capacity:
      // USDT recibidos sube con ventas asignadas y saldos completados.
      // Capacity restante baja con esa misma cobertura.
      // Pendiente proveedor baja con CLP recibido + saldo manual.
      pendingProviderClp: Math.max(totalCapacityCostClp - smartCoveredClp, 0),
      remainingCapacityUsdt: smartRemainingUsdt,
      smartReceivedUsdt,
      smartCoveredClp,
      unassignedSaleUsdt: Math.max(unassignedSaleUsdt - getP2POwnCapitalTotalUsdt(), 0),
      unassignedSaleClp,
      unassignedCommissionUsdt,
      unassignedSaleDetail
    };
  }

  function addP2PCapacityStyles(){
    if(document.getElementById("onzeP2PCapacityStyles")) return;

    const style = document.createElement("style");
    style.id = "onzeP2PCapacityStyles";
    style.textContent = `
      .p2p-dashboard-grid-centered .p2p-dashboard-card{
        display:flex;
        flex-direction:column;
        justify-content:flex-start;
        align-items:center;
        text-align:center;
        min-height:142px;
        padding-top:26px;
      }

      .p2p-dashboard-grid-centered .p2p-dashboard-label{
        width:100%;
        min-height:28px;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
      }

      .p2p-dashboard-grid-centered .p2p-dashboard-value{
        width:100%;
        justify-content:center;
        text-align:center;
        margin-top:8px;
      }

      .p2p-dashboard-grid-centered .p2p-dashboard-small{
        width:100%;
        text-align:center;
        margin-top:10px;
        line-height:1.2;
      }
      .p2p-capacity-actions{
        display:flex;
        gap:10px;
        flex-wrap:wrap;
        margin:14px 0;
      }

      .p2p-capacity-list{
        display:grid;
        gap:10px;
        margin-top:12px;
      }

      .p2p-capacity-card{
        border:1px solid rgba(52,211,153,.22);
        background:rgba(2,6,23,.46);
        border-radius:16px;
        padding:13px;
      }

      .p2p-capacity-top{
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:flex-start;
        flex-wrap:wrap;
      }

      .p2p-capacity-actions-row{
        display:flex;
        justify-content:flex-end;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
        margin-top:16px;
      }

      .p2p-action-icon-btn{
        width:44px;
        height:44px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:14px;
        border:1px solid rgba(96,165,250,.22);
        background:linear-gradient(180deg, rgba(30,64,175,.36), rgba(30,58,138,.24));
        color:#60a5fa;
        box-shadow:0 10px 24px rgba(15,23,42,.18);
        cursor:pointer;
        transition:transform .16s ease, border-color .16s ease, background .16s ease, color .16s ease;
      }

      .p2p-action-icon-btn:hover{
        transform:translateY(-1px);
        border-color:rgba(96,165,250,.45);
        background:linear-gradient(180deg, rgba(37,99,235,.42), rgba(30,64,175,.28));
        color:#93c5fd;
      }

      .p2p-action-icon-btn svg{
        width:20px;
        height:20px;
        stroke:currentColor;
        fill:none;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      .onze-metric-icon-btn{
        width:54px;
        height:54px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:16px;
        border:1px solid rgba(96,165,250,.22);
        background:linear-gradient(180deg, rgba(30,64,175,.30), rgba(15,23,42,.28));
        color:#60a5fa;
        box-shadow:0 10px 24px rgba(15,23,42,.16);
        cursor:pointer;
        transition:transform .16s ease, border-color .16s ease, background .16s ease, color .16s ease;
      }

      .onze-metric-icon-btn:hover{
        transform:translateY(-1px);
        border-color:rgba(147,197,253,.42);
        color:#93c5fd;
        background:linear-gradient(180deg, rgba(37,99,235,.34), rgba(30,64,175,.24));
      }

      .onze-metric-icon-btn svg{
        width:24px;
        height:24px;
        stroke:currentColor;
        fill:none;
        stroke-width:2.2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }


      .p2p-action-icon-btn.danger{
        border-color:rgba(248,113,113,.20);
        background:linear-gradient(180deg, rgba(127,29,29,.32), rgba(69,10,10,.22));
        color:#f87171;
      }

      .p2p-action-icon-btn.danger:hover{
        border-color:rgba(248,113,113,.42);
        color:#fca5a5;
        background:linear-gradient(180deg, rgba(153,27,27,.38), rgba(127,29,29,.24));
      }

      .p2p-action-main-btn{
        min-height:44px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:9px;
        padding:0 20px;
        border-radius:14px;
        border:1px solid rgba(96,165,250,.26);
        background:linear-gradient(180deg, rgba(37,99,235,.92), rgba(30,64,175,.86));
        color:#f8fafc;
        font-weight:950;
        letter-spacing:.01em;
        cursor:pointer;
        box-shadow:0 12px 28px rgba(37,99,235,.18);
        transition:transform .16s ease, border-color .16s ease, filter .16s ease;
      }

      .p2p-action-main-btn:hover{
        transform:translateY(-1px);
        border-color:rgba(147,197,253,.45);
        filter:brightness(1.06);
      }

      .p2p-action-main-btn svg{
        width:18px;
        height:18px;
        stroke:currentColor;
        fill:none;
        stroke-width:2.4;
        stroke-linecap:round;
        stroke-linejoin:round;
      }


      .p2p-capacity-title{
        color:#f8fafc;
        font-weight:950;
        font-size:15px;
      }

      .p2p-capacity-meta{
        color:#8aa0ba;
        font-weight:800;
        font-size:12px;
        margin-top:4px;
      }

      .p2p-capacity-value{
        color:#34d399;
        font-weight:950;
        text-align:right;
      }

      .p2p-capacity-mini-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:8px;
        margin-top:12px;
      }

      .p2p-capacity-mini{
        border:1px solid rgba(148,163,184,.13);
        border-radius:12px;
        padding:9px;
        background:rgba(15,23,42,.50);
      }

      .p2p-capacity-mini span{
        display:block;
        color:#8aa0ba;
        font-size:11px;
        font-weight:900;
        margin-bottom:4px;
      }

      .p2p-capacity-mini strong{
        color:#f8fafc;
        font-size:13px;
      }

      .p2p-capacity-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:9999;
        background:rgba(2,6,23,.76);
        backdrop-filter:blur(8px);
        display:none;
        align-items:flex-start;
        justify-content:center;
        padding:20px;
        overflow-y:auto;
      }
      .p2p-capacity-modal-backdrop.open{
        display:flex;
      }
      .p2p-capacity-modal{
        width:min(720px,100%);
        margin:auto;
        border:1px solid rgba(52,211,153,.28);
        background:linear-gradient(135deg,rgba(2,6,23,.98),rgba(8,22,37,.98));
        border-radius:24px;
        padding:22px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);
      }

      .p2p-capacity-modal-backdrop.open{
        display:flex;
      }

      .p2p-capacity-modal{
        width:min(720px,100%);
        border:1px solid rgba(52,211,153,.28);
        background:linear-gradient(135deg,rgba(2,6,23,.98),rgba(8,22,37,.98));
        border-radius:24px;
        padding:22px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);
      }

      .p2p-capacity-form{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:12px;
        margin-top:16px;
      }

      .p2p-capacity-form label{
        color:#a8b3c7;
        font-weight:900;
        font-size:13px;
      }

      .p2p-capacity-form input,
      .p2p-capacity-form textarea{
        width:100%;
        margin-top:7px;
        border:1px solid rgba(148,163,184,.18);
        background:rgba(2,6,23,.78);
        color:#f8fafc;
        border-radius:13px;
        padding:12px;
        font-size:14px;
        font-weight:800;
        outline:none;
      }

      .p2p-capacity-form textarea{
        min-height:78px;
        resize:vertical;
      }

      .p2p-capacity-form .full{
        grid-column:1 / -1;
      }

      .p2p-capacity-detail-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:10000;
        background:rgba(2,6,23,.78);
        backdrop-filter:blur(8px);
        display:none;
        align-items:flex-start;
        justify-content:center;
        padding:20px;
        overflow-y:auto;
      }
      .p2p-capacity-detail-modal-backdrop.open{
        display:flex;
      }
      .p2p-capacity-detail-modal{
        width:min(920px,100%);
        margin:auto;
        max-height:88vh;
        overflow:auto;
        border:1px solid rgba(52,211,153,.28);
        background:linear-gradient(135deg,rgba(2,6,23,.98),rgba(8,22,37,.98));
        border-radius:24px;
        padding:22px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);
      }

      .p2p-capacity-detail-modal-backdrop.open{
        display:flex;
      }

      .p2p-capacity-detail-modal{
        width:min(920px,100%);
        max-height:88vh;
        overflow:auto;
        border:1px solid rgba(52,211,153,.28);
        background:linear-gradient(135deg,rgba(2,6,23,.98),rgba(8,22,37,.98));
        border-radius:24px;
        padding:22px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);
      }

      .p2p-detail-summary-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:10px;
        margin-top:14px;
      }

      .p2p-detail-row{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:12px;
        border-top:1px solid rgba(148,163,184,.12);
        padding:10px 0;
      }

      @media(max-width:800px){
        .p2p-capacity-form,
        .p2p-capacity-mini-grid,
        .p2p-detail-summary-grid{
          grid-template-columns:1fr;
        }

        .p2p-detail-row{
          flex-direction:column;
        }
      }

      /* ── Retiros y gastos (Capital P2P) — pedido explícito del usuario
         (ago 2026): "muy básico, quiero algo más pro visualmente".
         Compartida entre el panel de ONZE (p2pWithdraw*) y el del socio
         (socioBnWithdraw*) -- clases genéricas, no atadas a IDs. ── */
      .p2p-withdraw-card{
        border:1px solid rgba(148,163,184,.14);
        background:linear-gradient(180deg,rgba(15,23,42,.6),rgba(2,6,23,.5));
        border-radius:18px;
        padding:16px;
      }

      .p2p-withdraw-toggle{
        display:inline-flex;
        gap:4px;
        padding:4px;
        border-radius:999px;
        background:rgba(2,6,23,.55);
        border:1px solid rgba(148,163,184,.16);
      }

      .p2p-withdraw-toggle-btn{
        border:none;
        border-radius:999px;
        padding:8px 18px;
        font-size:12px;
        font-weight:900;
        cursor:pointer;
        background:transparent;
        color:#8aa0ba;
        transition:background .15s ease,color .15s ease,box-shadow .15s ease;
        display:inline-flex;
        align-items:center;
        gap:6px;
      }

      .p2p-withdraw-toggle-btn.active.retiro{
        background:linear-gradient(180deg, rgba(37,99,235,.9), rgba(29,78,216,.85));
        color:#f8fafc;
        box-shadow:0 8px 18px rgba(37,99,235,.25);
      }

      .p2p-withdraw-toggle-btn.active.gasto{
        background:linear-gradient(180deg, rgba(217,119,6,.9), rgba(180,83,9,.85));
        color:#f8fafc;
        box-shadow:0 8px 18px rgba(217,119,6,.22);
      }

      .p2p-withdraw-ppm-btn{
        margin-left:auto;
        border:1px solid rgba(251,191,36,.28);
        background:rgba(217,119,6,.14);
        color:#fbbf24;
        border-radius:999px;
        padding:5px 6px 5px 14px;
        font-size:11.5px;
        font-weight:900;
        display:inline-flex;
        align-items:center;
        gap:7px;
      }

      .p2p-withdraw-ppm-btn input[type="month"]{
        background:rgba(2,6,23,.6);
        border:1px solid rgba(148,163,184,.2);
        border-radius:7px;
        color:#f8fafc;
        font-size:11px;
        font-weight:700;
        padding:3px 6px;
        color-scheme:dark;
      }

      .p2p-withdraw-ppm-btn button{
        border:none;
        background:rgba(251,191,36,.24);
        color:#fbbf24;
        border-radius:999px;
        padding:5px 12px;
        font-size:11px;
        font-weight:900;
        cursor:pointer;
        transition:background .15s ease;
      }

      .p2p-withdraw-ppm-btn button:hover{
        background:rgba(251,191,36,.38);
      }

      .p2p-withdraw-fields{
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
        gap:10px;
        margin-top:14px;
      }

      .p2p-withdraw-field label{
        display:block;
        font-size:10px;
        font-weight:900;
        text-transform:uppercase;
        letter-spacing:.05em;
        color:#64748b;
        margin-bottom:6px;
      }

      .p2p-withdraw-field input,
      .p2p-withdraw-field select{
        width:100%;
        box-sizing:border-box;
        background:rgba(2,6,23,.55);
        border:1px solid rgba(148,163,184,.18);
        border-radius:10px;
        padding:9px 10px;
        color:#f8fafc;
        font-size:13px;
        font-weight:700;
        transition:border-color .15s ease,box-shadow .15s ease;
        color-scheme:dark;
      }

      .p2p-withdraw-field input:focus,
      .p2p-withdraw-field select:focus{
        outline:none;
        border-color:rgba(52,211,153,.55);
        box-shadow:0 0 0 3px rgba(52,211,153,.14);
      }

      .p2p-withdraw-submit-row{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:12px;
        margin-top:14px;
      }

      .p2p-withdraw-submit-btn{
        border:1px solid rgba(52,211,153,.4);
        background:linear-gradient(180deg, rgba(16,185,129,.92), rgba(5,150,105,.9));
        color:#022c1f;
        font-weight:950;
        font-size:13px;
        border-radius:12px;
        padding:10px 22px;
        cursor:pointer;
        box-shadow:0 10px 24px rgba(16,185,129,.22);
        transition:transform .15s ease,filter .15s ease;
      }

      .p2p-withdraw-submit-btn:hover{
        transform:translateY(-1px);
        filter:brightness(1.05);
      }

      .p2p-withdraw-error{
        color:#fca5a5;
        font-size:12px;
        font-weight:700;
        min-height:16px;
        flex:1;
        text-align:left;
      }

      .p2p-withdraw-list{
        display:grid;
        gap:8px;
        margin-top:14px;
      }

      /* Pedido explícito del usuario (ago 2026): "Por día" ocupaba mucho
         espacio en el modal -- se colapsa por defecto (<details> nativo,
         sin JS) y se despliega solo si el usuario quiere verlo. */
      .p2p-collapsible{
        border:1px solid rgba(148,163,184,.14);
        border-radius:14px;
        background:rgba(15,23,42,.4);
        margin:16px 0 4px;
        overflow:hidden;
      }

      .p2p-collapsible summary{
        list-style:none;
        cursor:pointer;
        padding:11px 14px;
        font-size:12px;
        font-weight:900;
        color:#8aa0ba;
        display:flex;
        align-items:center;
        justify-content:space-between;
        user-select:none;
        transition:color .15s ease;
      }

      .p2p-collapsible summary:hover{
        color:#cbd5e1;
      }

      .p2p-collapsible summary::-webkit-details-marker{
        display:none;
      }

      .p2p-collapsible summary::after{
        content:'▾';
        color:#64748b;
        transition:transform .18s ease;
        font-size:11px;
      }

      .p2p-collapsible[open] summary{
        border-bottom:1px solid rgba(148,163,184,.1);
      }

      .p2p-collapsible[open] summary::after{
        transform:rotate(180deg);
      }

      .p2p-collapsible-body{
        padding:2px 14px 6px;
        max-height:360px;
        overflow-y:auto;
      }

      .p2p-withdraw-empty{
        font-size:12.5px;
        color:#64748b;
        font-weight:700;
        text-align:center;
        padding:14px 0;
      }

      .p2p-withdraw-row{
        display:flex;
        align-items:center;
        gap:12px;
        padding:10px 12px;
        border:1px solid rgba(148,163,184,.12);
        border-radius:14px;
        background:rgba(2,6,23,.4);
      }

      .p2p-withdraw-badge{
        width:36px;
        height:36px;
        border-radius:11px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:16px;
        flex-shrink:0;
      }

      .p2p-withdraw-badge.retiro{
        background:linear-gradient(180deg, rgba(37,99,235,.32), rgba(30,64,175,.2));
        border:1px solid rgba(96,165,250,.28);
      }

      .p2p-withdraw-badge.gasto{
        background:linear-gradient(180deg, rgba(217,119,6,.32), rgba(180,83,9,.2));
        border:1px solid rgba(251,191,36,.28);
      }

      .p2p-withdraw-row-body{
        flex:1;
        min-width:0;
      }

      .p2p-withdraw-row-name{
        color:#f8fafc;
        font-weight:900;
        font-size:13px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .p2p-withdraw-row-meta{
        color:#8aa0ba;
        font-size:11.5px;
        font-weight:700;
        margin-top:2px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .p2p-withdraw-row-amount{
        color:#fb7185;
        font-weight:950;
        font-size:14px;
        white-space:nowrap;
      }

      .p2p-withdraw-del-btn{
        width:30px;
        height:30px;
        border-radius:9px;
        border:1px solid rgba(248,113,113,.2);
        background:rgba(127,29,29,.18);
        color:#f87171;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        transition:background .15s ease,border-color .15s ease;
        flex-shrink:0;
        font-size:15px;
      }

      .p2p-withdraw-del-btn:hover{
        background:rgba(153,27,27,.32);
        border-color:rgba(248,113,113,.42);
      }

      @media(max-width:640px){
        .p2p-withdraw-row{
          flex-wrap:wrap;
        }
        .p2p-withdraw-row-amount{
          margin-left:48px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureP2PCapacityModal(){
    if(document.getElementById("p2pCapacityModalBackdrop")) return;

    const modal = document.createElement("div");
    modal.id = "p2pCapacityModalBackdrop";
    modal.className = "p2p-capacity-modal-backdrop";
    modal.innerHTML = `
      <div class="p2p-capacity-modal">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <h3 class="section-title" style="margin-bottom:6px;">Registrar capacity externo</h3>
            <p class="section-text">Registra el cupo comprado fuera de Binance para calcular ganancia real P2P.</p>
          </div>
          <button class="btn secondary" type="button" id="closeP2PCapacityModal">Cerrar</button>
        </div>

        <form id="p2pCapacityForm" class="p2p-capacity-form">
          <label>
            Proveedor
            <input id="p2pCapacityProvider" placeholder="Ej: Pedro / proveedor USDT" required>
          </label>

          <label>
            Fecha
            <input id="p2pCapacityDate" type="date" required>
          </label>

          <label>
            Capacity en CLP
            <input id="p2pCapacityClp" inputmode="decimal" placeholder="Ej: 8.200.000" required oninput="this.value=this.value.replace(/[^0-9]/g,\'\').replace(/\\B(?=(\\d{3})+(?!\\d))/g,\'.\');">
          </label>

          <label>
            Precio compra (CLP/USDT)
            <input id="p2pCapacityBuyPrice" inputmode="decimal" placeholder="Ej: 820" required>
          </label>

          <label>
            USDT estimados a recibir
            <input id="p2pCapacityUsdt" inputmode="decimal" placeholder="Se calcula automático" readonly>
          </label>

          <label>
            Pagado al proveedor (CLP)
            <input id="p2pCapacityPaid" inputmode="decimal" value="0">
          </label>

          <label>
            Referencia / cuenta / banco
            <input id="p2pCapacityReference" placeholder="Opcional">
          </label>

          <label class="full">
            Nota
            <textarea id="p2pCapacityNote" placeholder="Ej: cupo cerrado, se paga con ventas Binance"></textarea>
          </label>

          <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
            <button class="btn secondary" type="button" id="cancelP2PCapacity">Cancelar</button>
            <button class="btn" type="submit">Guardar capacity</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("closeP2PCapacityModal")?.addEventListener("click", closeP2PCapacityModal);
    document.getElementById("cancelP2PCapacity")?.addEventListener("click", closeP2PCapacityModal);

    ["p2pCapacityClp", "p2pCapacityBuyPrice"].forEach(id=>{
      document.getElementById(id)?.addEventListener("input", updateP2PCapacityUsdtPreview);
      document.getElementById(id)?.addEventListener("change", updateP2PCapacityUsdtPreview);
    });

    document.getElementById("p2pCapacityForm")?.addEventListener("submit", function(e){
      e.preventDefault();

      const provider = document.getElementById("p2pCapacityProvider")?.value || "";
      const date = document.getElementById("p2pCapacityDate")?.value || new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const capacityClp = p2pCapNumber(document.getElementById("p2pCapacityClp")?.value);
      const buyPrice = p2pCapNumber(document.getElementById("p2pCapacityBuyPrice")?.value);
      const usdtAmount = buyPrice > 0 ? capacityClp / buyPrice : 0;
      const paidClp = p2pCapNumber(document.getElementById("p2pCapacityPaid")?.value);
      const reference = document.getElementById("p2pCapacityReference")?.value || "";
      const note = document.getElementById("p2pCapacityNote")?.value || "";

      if(!provider.trim()){
        onzeAlert("Coloca el proveedor.");
        return;
      }

      if(capacityClp <= 0 || buyPrice <= 0 || usdtAmount <= 0){
        onzeAlert("Coloca un monto CLP de capacity y precio de compra válido.");
        return;
      }

      const items = loadP2PCapacity().slice();

      const newCapacity = {
        id: `cap_${Date.now()}`,
        provider: provider.trim(),
        date,
        capacityClp,
        usdtAmount,
        buyPrice,
        paidClp,
        status: "active",
        finishedAt: null,
        finalSoldUsdt: null,
        finalClpReceived: null,
        finalCommissionUsdt: null,
        finalCommissionClp: null,
        finalSaleParts: [],
        manualPaymentClp: null,
        manualPaymentsClp: null,
        reference: reference.trim(),
        note: note.trim(),
        createdAt: new Date().toISOString()
      };

      items.push(newCapacity);

      saveP2PCapacity(items);
      postP2PCapacityToServer(newCapacity, function(){
        console.log("✅ Capacity guardado en servidor:", newCapacity.id);
      });
      closeP2PCapacityModal();
      renderP2PCapacityPanel();
      updateP2PDashboardWithCapacity();

      // Auto-switch bot to capacity mode (set exchange-level fallback)
      botUpdateBuyPrice();
      const ex = window.botSelectedExchange || "binance";
      fetch("/api/p2p/bot/exchange-config", {
        method:"POST", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ exchange: ex, priceSource: "capacity", priceFloorPct: 0 })
      }).catch(()=>{});

      if(typeof showToast === "function"){
        showToast("Capacity P2P registrado");
      }
    });
  }

  function updateP2PCapacityUsdtPreview(){
    const clpEl = document.getElementById("p2pCapacityClp");
    const priceEl = document.getElementById("p2pCapacityBuyPrice");
    const usdtEl = document.getElementById("p2pCapacityUsdt");

    if(!clpEl || !priceEl || !usdtEl) return;

    const clp = p2pCapNumber(clpEl.value);
    const price = p2pCapNumber(priceEl.value);
    const usdt = price > 0 ? clp / price : 0;

    usdtEl.value = usdt > 0 ? p2pCapMoney(usdt, 2) : "";
  }

  function openP2PCapacityModal(){
    ensureP2PCapacityModal();

    const dateEl = document.getElementById("p2pCapacityDate");
    if(dateEl && !dateEl.value){
      dateEl.value = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    }

    updateP2PCapacityUsdtPreview();
    document.getElementById("p2pCapacityModalBackdrop")?.classList.add("open");
  }

  function closeP2PCapacityModal(){
    document.getElementById("p2pCapacityModalBackdrop")?.classList.remove("open");
    document.getElementById("p2pCapacityForm")?.reset();
  }

  function ensureP2PCapacityDetailModal(){
    if(document.getElementById("p2pCapacityDetailModalBackdrop")) return;

    const modal = document.createElement("div");
    modal.id = "p2pCapacityDetailModalBackdrop";
    modal.className = "p2p-capacity-detail-modal-backdrop";
    modal.innerHTML = `
      <div class="p2p-capacity-detail-modal">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <h3 class="section-title" style="margin-bottom:6px;">Detalle del capacity</h3>
            <p class="section-text">Operaciones Binance asignadas a este ciclo/capacity.</p>
          </div>
          <button class="btn secondary" type="button" id="closeP2PCapacityDetailModal">Cerrar</button>
        </div>

        <div id="p2pCapacityDetailContent" style="margin-top:16px;"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("closeP2PCapacityDetailModal")?.addEventListener("click", closeP2PCapacityDetailModal);
    modal.addEventListener("click", function(e){
      if(e.target === modal) closeP2PCapacityDetailModal();
    });
  }

  function closeP2PCapacityDetailModal(){
    document.getElementById("p2pCapacityDetailModalBackdrop")?.classList.remove("open");
  }

  window.openP2PCapacityDetail = function(id){
    ensureP2PCapacityDetailModal();

    const stats = calculateP2PCapacityStats();
    const item = stats.capacities.find(cap => cap.id === id);
    const content = document.getElementById("p2pCapacityDetailContent");

    if(!item || !content){
      onzeAlert("No encontré el detalle de este capacity.");
      return;
    }

    const parts = Array.isArray(item.saleParts)
      ? item.saleParts
          .filter(part => Number(part.assignedUsdt || 0) > 0)
          .sort((a,b)=> new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      : [];

    // Capacitys terminados hace más de un mes viajan "aligerados" (ver
    // /api/p2p/capacity, AGENTS.md): ya no traen el detalle venta-por-venta
    // (parts queda vacío a propósito), solo un resumen por día. Los totales
    // de acá SÍ siguen siendo exactos -- salen directo de finalSoldUsdt/
    // finalClpReceived/finalCommissionUsdt (guardados en Neon desde que el
    // capacity se cerró, nunca se tocan) en vez de sumar parts.
    const isLightened = item.status === "finished" && Array.isArray(item.dailyBuckets) && item.dailyBuckets.length > 0;

    const first = isLightened ? null : parts[0];
    const last = isLightened ? null : parts[parts.length - 1];
    const bucketDays = isLightened ? item.dailyBuckets.map(b => b.day).filter(Boolean).sort() : [];
    const firstBucketDay = bucketDays[0];
    const lastBucketDay = bucketDays[bucketDays.length - 1];

    const totalAssignedUsdt = isLightened ? Number(item.usedUsdt || 0) : parts.reduce((sum, part)=> sum + Number(part.assignedUsdt || 0), 0);
    const totalAssignedClp = isLightened ? Number(item.clpReceived || 0) : parts.reduce((sum, part)=> sum + Number(part.assignedClp || 0), 0);
    const totalCommissionUsdt = isLightened ? Number(item.commissionUsdt || 0) : parts.reduce((sum, part)=> sum + Number(part.commissionUsdt || 0), 0);
    const totalOrdersCount = isLightened ? item.dailyBuckets.reduce((s,b)=> s + Number(b.ordersCount || 0), 0) : parts.length;

    content.innerHTML = `
      <div class="p2p-capacity-card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="p2p-capacity-title">
              ${item.provider || "Proveedor"}
              <span style="display:inline-flex;margin-left:8px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:950;color:${item.status === "finished" ? "#94a3b8" : "#34d399"};background:${item.status === "finished" ? "rgba(148,163,184,.10)" : "rgba(52,211,153,.12)"};border:1px solid ${item.status === "finished" ? "rgba(148,163,184,.20)" : "rgba(52,211,153,.26)"};">
                ${item.status === "finished" ? "Finalizado" : "Activo"}
              </span>
            </div>
            <div class="p2p-capacity-meta">${item.date || ""} · Capacity ${p2pCapMoney(item.totalCost, 0)} CLP · Compra ${p2pCapMoney(item.buyPrice, 2)} CLP/USDT</div>
          </div>

          <div style="text-align:right;">
            <div class="p2p-capacity-value">${p2pCapMoney(item.usdtAmount, 2)} USDT</div>
            <div class="p2p-capacity-meta">USDT estimados a recibir</div>
          </div>
        </div>

        <div class="p2p-detail-summary-grid">
          <div class="p2p-capacity-mini">
            <span>Primera operación</span>
            <strong>${isLightened ? (firstBucketDay || "Sin operación") : (first ? p2pFormatAssignedSaleDate(first) : "Sin operación")}</strong>
            <div class="p2p-capacity-meta" style="margin-top:5px;word-break:break-all;">
              ${!isLightened && first ? `Orden: ${first.orderNumber || "Sin número"}` : ""}
            </div>
          </div>
          <div class="p2p-capacity-mini">
            <span>Última operación</span>
            <strong>${isLightened ? (lastBucketDay || "Sin operación") : (last ? p2pFormatAssignedSaleDate(last) : "Sin operación")}</strong>
            <div class="p2p-capacity-meta" style="margin-top:5px;word-break:break-all;">
              ${!isLightened && last ? `Orden: ${last.orderNumber || "Sin número"}` : ""}
            </div>
          </div>
          <div class="p2p-capacity-mini">
            <span>Total operaciones</span>
            <strong>${totalOrdersCount}</strong>
          </div>
          <div class="p2p-capacity-mini">
            <span>USDT vendido</span>
            <strong>${p2pCapMoney(totalAssignedUsdt, 2)} USDT</strong>
          </div>
          <div class="p2p-capacity-mini">
            <span>CLP recibido</span>
            <strong>${p2pCapMoney(totalAssignedClp, 0)} CLP</strong>
          </div>
          <div class="p2p-capacity-mini">
            <span>Comisión Binance</span>
            <strong>${p2pCapMoney(totalCommissionUsdt, 4)} USDT</strong>
            <div class="p2p-capacity-meta" style="margin-top:5px;">${p2pCapMoney(item.commissionPct, 4)}% aprox.</div>
          </div>
          <div class="p2p-capacity-mini">
            <span>Costo usado</span>
            <strong>${p2pCapMoney(item.usedCost, 0)} CLP</strong>
          </div>
          <div class="p2p-capacity-mini">
            <span>Restante</span>
            <strong>${p2pCapMoney(item.remainingUsdt, 2)} USDT</strong>
            <div class="p2p-capacity-meta" style="margin-top:5px;">${p2pCapMoney(item.pendingClp, 0)} CLP</div>
          </div>
          <div class="p2p-capacity-mini">
            <span>Ganancia</span>
            <strong style="color:${item.profitUsdt >= 0 ? "#34d399" : "#fb7185"};">${item.profitUsdt >= 0 ? "+" : "-"}${p2pCapMoney(Math.abs(item.profitUsdt), 2)} USDT</strong>
            <div class="p2p-capacity-meta" style="margin-top:5px;">${item.profitClp >= 0 ? "+" : "-"}${p2pCapMoney(Math.abs(item.profitClp), 0)} CLP</div>
          </div>
          ${
            Number(item.manualPaymentClp || item.manualPaymentsClp || item.paidClp || 0) > 0
            ? `<div class="p2p-capacity-mini" style="cursor:pointer;" onclick="window.openManualPaymentsModal('${item.id}')" title="Click para ver el detalle de cada pago">
                <span>Pago manual ›</span>
                <strong style="color:#fbbf24;">${p2pCapMoney(Number(item.manualPaymentClp || item.manualPaymentsClp || item.paidClp || 0), 0)} CLP</strong>
              </div>`
            : ""
          }
        </div>
      </div>

      <div style="margin-top:14px;">
        <h3 class="section-title" style="margin-bottom:8px;">Operaciones asignadas</h3>

        ${
          isLightened
            ? `<div class="p2p-dashboard-empty">Este capacity es de un mes anterior -- para aligerar el panel, el detalle venta por venta ya no se guarda acá (los totales de arriba SÍ son exactos, salen del cierre original del capacity).</div>`
          : !parts.length
            ? `<div class="p2p-dashboard-empty">Todavía no hay operaciones asignadas a este capacity.</div>`
            : `<div class="p2p-capacity-card">
                ${parts.map((part, index) => {
                  const isPartial = Number(part.originalSaleUsdt || 0) > Number(part.assignedUsdt || 0);
                  return `
                    <div class="p2p-detail-row">
                      <div>
                        <strong style="color:#f8fafc;font-size:13px;">#${index + 1} · ${p2pCapMoney(part.assignedUsdt, 2)} USDT</strong>
                        <div class="p2p-capacity-meta" style="margin-top:3px;">${p2pFormatAssignedSaleDate(part)}</div>
                        <div class="p2p-capacity-meta" style="margin-top:3px;">Orden: ${p2pShortOrderNumber(part.orderNumber)}</div>
                        ${isPartial ? `<div class="p2p-capacity-meta" style="margin-top:3px;color:#fbbf24;">Parcial: esta venta fue repartida entre capacities.</div>` : ""}
                      </div>

                      <div style="text-align:right;">
                        <strong style="color:#34d399;font-size:13px;">${p2pCapMoney(part.unitPrice, 2)} CLP/USDT</strong>
                        <div class="p2p-capacity-meta" style="margin-top:3px;">${p2pCapMoney(part.assignedClp, 0)} CLP</div>
                        <div class="p2p-capacity-meta" style="margin-top:3px;">Comisión: ${p2pCapMoney(part.commissionUsdt, 4)} USDT</div>
                        ${String(part.orderNumber || '').startsWith('manual_') ? `<button class="btn small danger" type="button" title="Borrar venta manual" style="padding:2px 6px;font-size:12px;line-height:1;" onclick="onzeConfirm('¿Borrar esta venta manual? Se recalcularán las capacidades.').then(function(ok){if(ok){document.getElementById('p2pCapacityDetailModalBackdrop')?.classList.remove('open');setTimeout(()=>window.deleteManualSale('${part.orderNumber}'),100);}})">🗑️</button>` : ""}
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>`
        }
      </div>
    `;

    document.getElementById("p2pCapacityDetailModalBackdrop")?.classList.add("open");
  };


  // Modal para completar capacity con monto manual
  window.openCompleteCapacityModal = async function(id){
    const capacities = loadP2PCapacity();
    const cap = capacities.find(c => c.id === id);
    if(!cap) { onzeAlert("Capacity no encontrado"); return; }

    const stats = calculateP2PCapacityStats();
    const capStats = stats.capacities.find(c => c.id === id);
    if(!capStats) { onzeAlert("No se pudo calcular el restante"); return; }

    const remainingUsdt = Number(capStats.remainingUsdt || 0);
    const capacityClpTotal = Number(cap.capacityClp || 0);
    const existingManualPaid = Number(cap.manualPaymentsClp || 0);
    const clpReceived = Number(capStats.clpReceived || 0);
    // Restante = lo que falta por cubrir del capacity total, descontando
    // ventas reales Y pagos manuales ya hechos (ver finishCapacityManually).
    const remainingClp = Math.max(capacityClpTotal - existingManualPaid - clpReceived, 0);

    if(remainingClp <= 0){
      if(await onzeConfirm("Este capacity ya está cubierto por completo. ¿Marcar como completado?")){
        finishCapacityManually(id, 0);
      }
      return;
    }

    // Crear modal
    let modal = document.getElementById("completeCapacityModal");
    if(modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "completeCapacityModal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;";
    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:420px;width:90%;">
        <h3 style="color:#00d4ff;margin-bottom:8px;">✅ Completar capacity manualmente</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:16px;">
          Proveedor: <strong style="color:#fff;">${cap.provider || ""}</strong><br>
          Restante: <strong style="color:#00ff88;">${Math.round(remainingClp).toLocaleString("es-CL")} CLP</strong> (${remainingUsdt.toFixed(2)} USDT)
        </p>
        <p style="color:#aaa;font-size:12px;margin-bottom:8px;">
          Ingresa cuánto CLP pagas manualmente. Si pagas todo, el capacity se cierra.
          Si pagas una parte, el capacity baja y sigue activo.
        </p>
        <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Monto en CLP a completar</label>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input id="completeCapacityAmount" type="text" inputmode="decimal" placeholder="Ej: 1.500.000" oninput="this.value=this.value.replace(/[^0-9]/g,\'\').replace(/\\B(?=(\\d{3})+(?!\\d))/g,\'.\');"
            style="flex:1;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;">
          <button onclick="document.getElementById('completeCapacityAmount').value = Math.round(${remainingClp}).toLocaleString('es-CL')"
            style="padding:10px 16px;background:#1a3a5a;color:#00d4ff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">MAX</button>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="document.getElementById('completeCapacityModal').remove()"
            style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
          <button onclick="confirmCompleteCapacity('${id}')"
            style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.confirmCompleteCapacity = function(id){
    const input = document.getElementById("completeCapacityAmount");
    const amountClp = Number((input?.value || "").replace(/[^0-9]/g, ""));

    if(!amountClp || amountClp <= 0){
      onzeAlert("Ingresa un monto válido");
      return;
    }

    finishCapacityManually(id, amountClp);
    document.getElementById("completeCapacityModal")?.remove();
  };

  window.finishCapacityManually = function(id, manualClpPayment){
    // Mismo resguardo que autoFinishP2PCapacities() -- completar a mano
    // también usa calculateP2PCapacityStats(), así que también podría
    // incluir por error una venta ya marcada como "capital propio" si esa
    // lista todavía no cargó del servidor.
    if(!window.__p2pCapitalMarkedSalesLoaded){
      onzeAlert("Todavía se está cargando información del servidor. Esperá unos segundos y probá de nuevo.");
      return;
    }

    const capacities = loadP2PCapacity().slice();
    const idx = capacities.findIndex(c => c.id === id);
    if(idx < 0) return;

    const cap = capacities[idx];
    const stats = calculateP2PCapacityStats();
    const capStats = stats.capacities.find(c => c.id === id);
    if(!capStats) return;

    // Pedido explícito del usuario (ago 2026): "Completar saldo" (pago
    // manual directo al proveedor, ej. plata enviada por fuera para tener
    // USDT sin pasar por una venta de Binance) tiene que descontar el saldo
    // restante y nada más -- NO debe tocar el monto total del capacity
    // (capacityClp/usdtAmount). Antes SÍ lo reducía, y como las ventas
    // reales se recalculan siempre desde cero contra el monto total, las
    // ventas ya asignadas antes del pago manual quedaban compitiendo por un
    // monto más chico y el "Restante" dejaba de coincidir con lo que
    // realmente se le debía al proveedor (confirmado en vivo, capacity
    // #265: 5.000.000 → 3.018.000 tras un pago manual de 1.982.000 rompió
    // el cálculo). Ahora el pago manual solo se acumula en
    // manualPaymentsClp, y calculateP2PCapacityStats() ya lo resta del
    // disponible para ventas reales (ver el loop de asignación más arriba)
    // -- ambas formas de pago compiten por el mismo monto fijo, sin pisarse.
    const capacityClpTotal = Number(cap.capacityClp || 0);
    const existingManualPaid = Number(cap.manualPaymentsClp || 0);
    const clpReceived = Number(capStats.clpReceived || 0);
    const remainingClp = Math.max(capacityClpTotal - existingManualPaid - clpReceived, 0);
    const payment = Math.min(manualClpPayment, remainingClp);
    const newManualPaid = existingManualPaid + payment;

    // Pedido explícito del usuario (ago 2026): poder ver cada pago manual
    // por separado y borrar uno puntual si se equivocó -- antes solo se
    // guardaba el total acumulado (manualPaymentsClp), sin detalle. Se
    // agrega un registro por cada pago (id, monto, fecha) en
    // manualPayments; manualPaymentsClp sigue existiendo como el total (se
    // sigue leyendo en varios lugares) pero ahora se recalcula siempre como
    // la suma de manualPayments, nunca a mano.
    const existingPayments = Array.isArray(cap.manualPayments) ? cap.manualPayments : [];
    const newPayments = payment > 0
      ? [...existingPayments, { id: `manualpay_${Date.now()}`, amountClp: payment, createdAt: new Date().toISOString() }]
      : existingPayments;

    if(payment >= remainingClp * 0.99){
      // Ya no queda nada por cubrir (ni por ventas reales ni por pago manual) -> cerrar
      capacities[idx] = {
        ...cap,
        status: "finished",
        finishedAt: new Date().toISOString(),
        finalSoldUsdt: Number(capStats.usedUsdt || 0),
        finalClpReceived: clpReceived,
        finalCommissionUsdt: Number(capStats.commissionUsdt || 0),
        finalCommissionClp: Number(capStats.commissionClp || 0),
        finalSaleParts: capStats.saleParts || [],
        manualPaymentClp: Number(cap.manualPaymentClp || 0) + payment,
        manualPaymentsClp: newManualPaid,
        manualPayments: newPayments
      };
    } else {
      capacities[idx] = {
        ...cap,
        manualPaymentsClp: newManualPaid,
        manualPayments: newPayments
      };
    }

    saveP2PCapacity(capacities);
    postP2PCapacityToServer(capacities[idx], null, { manualAction: true });

    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();

    if(typeof showToast === "function"){
      showToast("✅ Capacity actualizado");
    }
  };

  // Pedido explícito del usuario (ago 2026): clickear la tarjeta "Pago
  // manual" abre el detalle de cada pago hecho al proveedor (fecha + monto)
  // con opción de borrar uno puntual si se equivocó -- antes solo se veía
  // el total acumulado, sin forma de corregir un pago mal cargado.
  window.openManualPaymentsModal = function(capacityId){
    const capacities = loadP2PCapacity();
    const cap = capacities.find(c => c.id === capacityId);
    if(!cap){ onzeAlert("No encontré este capacity."); return; }

    let modal = document.getElementById("manualPaymentsModal");
    if(modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "manualPaymentsModal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;";
    modal.addEventListener("click", function(e){ if(e.target === modal) modal.remove(); });

    document.body.appendChild(modal);
    renderManualPaymentsModalBody(capacityId);
  };

  function renderManualPaymentsModalBody(capacityId){
    const modal = document.getElementById("manualPaymentsModal");
    if(!modal) return;

    const capacities = loadP2PCapacity();
    const cap = capacities.find(c => c.id === capacityId);
    if(!cap){ modal.remove(); return; }

    const payments = Array.isArray(cap.manualPayments) ? cap.manualPayments.slice().sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0)) : [];
    const total = payments.reduce((sum, p) => sum + Number(p.amountClp || 0), 0);

    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:460px;width:90%;">
        <h3 style="color:#00d4ff;margin-bottom:4px;">💵 Pagos manuales</h3>
        <p style="color:#8aa0ba;font-size:12px;margin-bottom:16px;">${cap.provider || ""} · ${cap.date || ""}</p>
        <div style="max-height:340px;overflow-y:auto;">
          ${payments.length ? payments.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);">
              <div>
                <strong style="color:#fbbf24;">${Math.round(Number(p.amountClp||0)).toLocaleString("es-CL")} CLP</strong>
                <div style="color:#8aa0ba;font-size:12px;margin-top:2px;">${p.createdAt ? new Date(p.createdAt).toLocaleString("es-CL", { timeZone:"America/Santiago", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }) : ""}</div>
              </div>
              <button class="btn small danger" type="button" onclick="window.deleteManualPayment('${capacityId}','${p.id}')" title="Borrar este pago" style="padding:6px 10px;font-size:13px;">🗑️</button>
            </div>
          `).join("") : `<div style="color:#8aa0ba;font-size:13px;padding:14px 0;text-align:center;">Sin pagos manuales registrados.</div>`}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid rgba(148,163,184,.14);">
          <span style="color:#8aa0ba;font-size:13px;">Total pagado manual</span>
          <strong style="color:#fbbf24;">${Math.round(total).toLocaleString("es-CL")} CLP</strong>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <button class="btn secondary" type="button" onclick="document.getElementById('manualPaymentsModal').remove()">Cerrar</button>
        </div>
      </div>
    `;
  }

  window.deleteManualPayment = async function(capacityId, paymentId){
    const ok = await onzeConfirm("¿Borrar este pago manual? Esto le va a devolver ese monto al saldo restante del capacity.");
    if(!ok) return;

    const capacities = loadP2PCapacity().slice();
    const idx = capacities.findIndex(c => c.id === capacityId);
    if(idx < 0) return;

    const cap = capacities[idx];
    const payments = Array.isArray(cap.manualPayments) ? cap.manualPayments : [];
    const remaining = payments.filter(p => p.id !== paymentId);
    const newTotal = remaining.reduce((sum, p) => sum + Number(p.amountClp || 0), 0);

    // Si el capacity ya estaba "finished" porque este pago manual lo cerró
    // del todo, reabrirlo -- borrar un pago puede dejar saldo pendiente de
    // nuevo, y calculateP2PCapacityStats() necesita recalcularlo desde
    // "active" (un capacity "finished" queda congelado, ver el loop de
    // asignación en calculateP2PCapacityStats).
    capacities[idx] = {
      ...cap,
      manualPayments: remaining,
      manualPaymentsClp: newTotal,
      ...(cap.status === "finished" ? {
        status: "active",
        finishedAt: null,
        finalSoldUsdt: null,
        finalClpReceived: null,
        finalCommissionUsdt: null,
        finalCommissionClp: null,
        finalSaleParts: [],
      } : {})
    };

    saveP2PCapacity(capacities);
    postP2PCapacityToServer(capacities[idx]);

    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();

    if(document.getElementById("manualPaymentsModal")){
      renderManualPaymentsModalBody(capacityId);
    }
    if(typeof showToast === "function") showToast("Pago manual borrado");
  };

  window.openCompletedCapacitiesModal = function(){
    const allCapacities = loadP2PCapacity().filter(c => c.status === "finished" && c.provider !== "_initial_capital")
      .sort((a,b)=> new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0));

    let modal = document.getElementById("completedCapacitiesModal");
    if(modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "completedCapacitiesModal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";

    function cardHtml(cap, index){
      const finishedDate = cap.finishedAt ? new Date(cap.finishedAt).toLocaleString("es-CL", { timeZone:"America/Santiago", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "";
      const finalSoldUsdt = Number(cap.finalSoldUsdt || 0);
      const finalClpReceived = Number(cap.finalClpReceived || 0);
      const finalCommissionUsdt = Number(cap.finalCommissionUsdt || 0);
      const buyPrice = Number(cap.buyPrice || 0);
      const costUsed = finalSoldUsdt * buyPrice;
      const profitClp = finalClpReceived - costUsed - (finalCommissionUsdt * buyPrice);
      const manualPayment = Number(cap.manualPaymentsClp || cap.manualPaymentClp || 0);

      return `
        <div style="background:#0d2137;border:1px solid #1a3a5a;border-radius:12px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div>
              <strong style="color:#fff;font-size:15px;">#${index + 1} · ${cap.provider || "Proveedor"}</strong>
              <div style="color:#8aa0ba;font-size:12px;margin-top:2px;">Finalizado: ${finishedDate || "sin fecha"}</div>
            </div>
            <span style="background:#1a3a5a;color:#00d4ff;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:bold;">COMPLETADO</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:13px;">
            <div><span style="color:#8aa0ba;">Capacity:</span><br><strong style="color:#fff;">${Math.round(Number(cap.capacityClp || 0)).toLocaleString("es-CL")} CLP</strong></div>
            <div><span style="color:#8aa0ba;">Tasa:</span><br><strong style="color:#fff;">${buyPrice.toFixed(2)} CLP/USDT</strong></div>
            <div><span style="color:#8aa0ba;">USDT vendido:</span><br><strong style="color:#fff;">${finalSoldUsdt.toFixed(2)} USDT</strong></div>
            <div><span style="color:#8aa0ba;">CLP recibido:</span><br><strong style="color:#fff;">${Math.round(finalClpReceived).toLocaleString("es-CL")} CLP</strong></div>
            <div><span style="color:#8aa0ba;">USDT recibidos:</span><br><strong style="color:#34d399;">${(buyPrice > 0 ? finalClpReceived / buyPrice : 0).toFixed(2)}</strong></div>
            ${manualPayment > 0 ? `<div><span style="color:#8aa0ba;">Pago manual:</span><br><strong style="color:#fbbf24;">${Math.round(manualPayment).toLocaleString("es-CL")} CLP</strong></div>` : ''}
            <div><span style="color:#8aa0ba;">Ganancia:</span><br><strong style="color:${profitClp >= 0 ? '#34d399' : '#fb7185'};">${profitClp >= 0 ? '+' : ''}${Math.round(profitClp).toLocaleString("es-CL")} CLP</strong><br><strong style="color:${profitClp >= 0 ? '#34d399' : '#fb7185'};font-size:12px;">${profitClp >= 0 ? '+' : ''}${(buyPrice > 0 ? profitClp / buyPrice : 0).toFixed(2)} USDT</strong></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="p2p-action-icon-btn" onclick="openP2PCapacityDetail('${cap.id}'); document.getElementById('completedCapacitiesModal').remove();" style="width:38px;height:38px;border-radius:12px;">
              <svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></svg></button>
            <button class="p2p-action-icon-btn danger" onclick="deleteP2PCapacity('${cap.id}')" style="width:38px;height:38px;border-radius:12px;">
              <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      `;
    }

    // Items sin finishedAt (dato legado, no debería pasar de aquí en más)
    // se muestran SIEMPRE sin importar el filtro elegido -- así nunca
    // desaparecen de la vista solo por no tener fecha.
    function renderCards(fromStr, toStr){
      const filtered = allCapacities.filter(cap => {
        const day = p2pChileDayKey(cap.finishedAt);
        return !day || (day >= fromStr && day <= toStr);
      });
      const container = document.getElementById("completedCapacitiesCards");
      if(!container) return;
      container.innerHTML = filtered.length === 0
        ? '<div style="text-align:center;color:#8aa0ba;padding:40px;">No hay capacities completados en este rango.</div>'
        : filtered.map(cardHtml).join("");
    }

    const today = p2pChileDayKey();
    function yesterdayStr(){
      const d = new Date(today + "T12:00:00");
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }

    modal.innerHTML = `
      <div style="background:#071828;border:1px solid #1a3a5a;border-radius:16px;padding:24px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="color:#00d4ff;margin:0;">📋 Capacities completados</h3>
          <button onclick="document.getElementById('completedCapacitiesModal').remove()"
            style="padding:8px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
        <p style="color:#8aa0ba;font-size:13px;margin-bottom:12px;">Capacities cerrados (vendidos completamente o completados manualmente).</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
          <button class="btn" type="button" id="completedCapacitiesQuickToday" style="padding:5px 10px;font-size:12px;">Hoy</button>
          <button class="btn secondary" type="button" id="completedCapacitiesQuickYesterday" style="padding:5px 10px;font-size:12px;">Ayer</button>
          <button class="btn secondary" type="button" id="completedCapacitiesRangeToggle" style="padding:5px 10px;font-size:12px;">Rango de fechas</button>
        </div>
        <div id="completedCapacitiesRangeRow" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Desde <input type="date" id="completedCapacitiesFrom" value="${today}" style="font-size:12px;" /></label>
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Hasta <input type="date" id="completedCapacitiesTo" value="${today}" style="font-size:12px;" /></label>
          <button class="btn" type="button" id="completedCapacitiesRangeApply" style="padding:5px 14px;font-size:12px;">Ver</button>
        </div>
        <div id="completedCapacitiesCards"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnToday = document.getElementById("completedCapacitiesQuickToday");
    const btnYesterday = document.getElementById("completedCapacitiesQuickYesterday");
    const btnRangeToggle = document.getElementById("completedCapacitiesRangeToggle");
    const rangeRow = document.getElementById("completedCapacitiesRangeRow");

    function setActiveQuick(which){
      btnToday.className = which === "today" ? "btn" : "btn secondary";
      btnYesterday.className = which === "yesterday" ? "btn" : "btn secondary";
      btnRangeToggle.className = which === "range" ? "btn" : "btn secondary";
    }

    btnToday.addEventListener("click", function(){
      rangeRow.style.display = "none";
      setActiveQuick("today");
      renderCards(today, today);
    });
    btnYesterday.addEventListener("click", function(){
      rangeRow.style.display = "none";
      setActiveQuick("yesterday");
      const y = yesterdayStr();
      renderCards(y, y);
    });
    btnRangeToggle.addEventListener("click", function(){
      setActiveQuick("range");
      rangeRow.style.display = rangeRow.style.display === "none" ? "flex" : "none";
    });
    document.getElementById("completedCapacitiesRangeApply").addEventListener("click", function(){
      const from = document.getElementById("completedCapacitiesFrom").value || today;
      const to = document.getElementById("completedCapacitiesTo").value || today;
      renderCards(from, to);
    });

    setActiveQuick("today");
    renderCards(today, today);
  };

  function ensureP2PCapacityDeleteModal(){
    if(document.getElementById("p2pCapacityDeleteModalBackdrop")) return;

    const modal = document.createElement("div");
    modal.id = "p2pCapacityDeleteModalBackdrop";
    modal.className = "p2p-capacity-modal-backdrop";
    modal.innerHTML = `
      <div class="p2p-capacity-modal" style="max-width:560px;border-color:rgba(248,113,113,.28);">
        <div style="display:flex;gap:14px;align-items:flex-start;">
          <div style="width:46px;height:46px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.25);color:#fb7185;flex:0 0 auto;">
            <svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round;">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </div>

          <div style="min-width:0;width:100%;">
            <h3 class="section-title" style="margin:0 0 6px;color:#f8fafc;">Eliminar capacity P2P</h3>
            <p class="section-text" id="p2pCapacityDeleteText" style="margin:0;">
              Esta acción eliminará el capacity seleccionado.
            </p>

            <div style="margin-top:14px;border:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.50);border-radius:16px;padding:12px;">
              <div style="color:#94a3b8;font-size:12px;font-weight:900;margin-bottom:4px;">Capacity seleccionado</div>
              <div id="p2pCapacityDeleteName" style="color:#f8fafc;font-size:15px;font-weight:950;">-</div>
              <div id="p2pCapacityDeleteMeta" style="color:#8aa0ba;font-size:12px;font-weight:800;margin-top:4px;">-</div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px;">
              <button class="btn secondary" type="button" id="cancelP2PCapacityDelete">Cancelar</button>
              <button class="p2p-action-main-btn" type="button" id="confirmP2PCapacityDelete" style="border-color:rgba(248,113,113,.35);background:linear-gradient(180deg,rgba(220,38,38,.95),rgba(127,29,29,.90));box-shadow:0 12px 28px rgba(220,38,38,.16);">
                Eliminar capacity
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("cancelP2PCapacityDelete")?.addEventListener("click", closeP2PCapacityDeleteModal);
    modal.addEventListener("click", function(e){
      if(e.target === modal) closeP2PCapacityDeleteModal();
    });
  }

  function closeP2PCapacityDeleteModal(){
    const modal = document.getElementById("p2pCapacityDeleteModalBackdrop");
    if(modal){
      modal.classList.remove("open");
      modal.dataset.capacityId = "";
    }
  }

  function openP2PCapacityDeleteModal(id){
    ensureP2PCapacityDeleteModal();

    const modal = document.getElementById("p2pCapacityDeleteModalBackdrop");
    const item = loadP2PCapacity().find(cap => cap.id === id);

    if(!modal || !item){
      if(typeof showToast === "function") showToast("No encontré este capacity");
      return;
    }

    modal.dataset.capacityId = id;

    const nameEl = document.getElementById("p2pCapacityDeleteName");
    const metaEl = document.getElementById("p2pCapacityDeleteMeta");
    const confirmBtn = document.getElementById("confirmP2PCapacityDelete");

    if(nameEl) nameEl.textContent = item.provider || "Proveedor";
    if(metaEl){
      const clp = p2pCapMoney(Number(item.capacityClp || item.totalCost || 0), 0);
      const price = p2pCapMoney(Number(item.buyPrice || 0), 2);
      metaEl.textContent = `${item.date || "Sin fecha"} · ${clp} CLP · ${price} CLP/USDT`;
    }

    if(confirmBtn){
      confirmBtn.onclick = function(){
        window.deleteP2PCapacity(modal.dataset.capacityId, true);
      };
    }

    modal.classList.add("open");
    modal.style.zIndex = "10001";
  }

  function closeP2PCapacityEditModal(){
    const modal = document.getElementById("p2pCapacityEditModalBackdrop");
    if(modal){
      modal.classList.remove("open");
      modal.dataset.capacityId = "";
    }
  }

  function ensureP2PCapacityEditModal(){
    if(document.getElementById("p2pCapacityEditModalBackdrop")) return;
    const modal = document.createElement("div");
    modal.id = "p2pCapacityEditModalBackdrop";
    modal.className = "p2p-capacity-modal-backdrop";
    modal.innerHTML = `
      <div class="p2p-capacity-modal">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <h3 class="section-title" style="margin-bottom:6px;">Editar capacity</h3>
            <p class="section-text">Modifica los datos del capacity. Las ventas ya asignadas se recalculan automáticamente.</p>
          </div>
          <button class="btn secondary" type="button" id="closeP2PCapacityEditModal">Cerrar</button>
        </div>

        <form id="p2pCapacityEditForm" class="p2p-capacity-form">
          <label class="full">
            Proveedor
            <input id="editP2pProvider" placeholder="Ej: Pedro / proveedor USDT" required>
          </label>
          <label>
            Fecha
            <input id="editP2pDate" type="date" required>
          </label>
          <label>
            Precio compra (CLP/USDT)
            <input id="editP2pBuyPrice" inputmode="decimal" placeholder="Ej: 820" required>
          </label>
          <label>
            Capacity en CLP
            <input id="editP2pCapacityClp" inputmode="decimal" placeholder="Ej: 8.200.000" required oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');">
          </label>
          <label>
            USDT estimados
            <input id="editP2pUsdt" inputmode="decimal" placeholder="Se calcula automático" readonly>
          </label>
          <label>
            Pagado al proveedor (CLP)
            <input id="editP2pPaid" inputmode="decimal" value="0">
          </label>
          <label>
            Referencia / cuenta / banco
            <input id="editP2pReference" placeholder="Opcional">
          </label>
          <label class="full">
            Nota
            <textarea id="editP2pNote" placeholder="Ej: cupo cerrado, se paga con ventas Binance"></textarea>
          </label>

          <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
            <button class="btn secondary" type="button" id="cancelP2PCapacityEdit">Cancelar</button>
            <button class="btn" type="submit">Guardar cambios</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("cancelP2PCapacityEdit")?.addEventListener("click", closeP2PCapacityEditModal);
    modal.addEventListener("click", function(e){
      if(e.target === modal) closeP2PCapacityEditModal();
    });

    document.getElementById("closeP2PCapacityEditModal")?.addEventListener("click", closeP2PCapacityEditModal);
    document.getElementById("cancelP2PCapacityEdit")?.addEventListener("click", closeP2PCapacityEditModal);

    ["editP2pCapacityClp", "editP2pBuyPrice"].forEach(id=>{
      const el = document.getElementById(id);
      if(el){
        el.addEventListener("input", updateP2PCapacityEditUsdtPreview);
        el.addEventListener("change", updateP2PCapacityEditUsdtPreview);
      }
    });

    document.getElementById("p2pCapacityEditForm")?.addEventListener("submit", function(e){
      e.preventDefault();
      const id = modal.dataset.capacityId;
      if(!id) return;
      const provider = document.getElementById("editP2pProvider")?.value || "";
      const date = document.getElementById("editP2pDate")?.value || "";
      const capacityClp = p2pCapNumber(document.getElementById("editP2pCapacityClp")?.value);
      const buyPrice = p2pCapNumber(document.getElementById("editP2pBuyPrice")?.value);
      const usdtAmount = buyPrice > 0 ? capacityClp / buyPrice : 0;
      const paidClp = p2pCapNumber(document.getElementById("editP2pPaid")?.value);
      const reference = document.getElementById("editP2pReference")?.value || "";
      const note = document.getElementById("editP2pNote")?.value || "";

      if(!provider.trim()){
        onzeAlert("Coloca el proveedor.");
        return;
      }
      if(capacityClp <= 0 || buyPrice <= 0 || usdtAmount <= 0){
        onzeAlert("Coloca un monto CLP de capacity y precio de compra válido.");
        return;
      }

      const items = loadP2PCapacity().slice();
      const idx = items.findIndex(cap => cap.id === id);
      if(idx === -1){
        onzeAlert("No encontré este capacity.");
        return;
      }

      items[idx].provider = provider.trim();
      items[idx].date = date;
      items[idx].capacityClp = capacityClp;
      items[idx].usdtAmount = usdtAmount;
      items[idx].buyPrice = buyPrice;
      items[idx].paidClp = paidClp;
      items[idx].reference = reference.trim();
      items[idx].note = note.trim();

      saveP2PCapacity(items);
      postP2PCapacityToServer(items[idx]);

      closeP2PCapacityEditModal();
      renderP2PCapacityPanel();
      updateP2PDashboardWithCapacity();
      if(typeof showToast === "function") showToast("Capacity actualizado");
    });
  }

  window.openP2PCapacityEditModal = function openP2PCapacityEditModal(id){
    ensureP2PCapacityEditModal();
    const modal = document.getElementById("p2pCapacityEditModalBackdrop");
    if(!modal) return;
    modal.dataset.capacityId = id;

    const stats = calculateP2PCapacityStats();
    const item = stats.capacities.find(cap => cap.id === id);
    if(!item){
      onzeAlert("No encontré este capacity.");
      return;
    }

    document.getElementById("editP2pProvider").value = item.provider || "";
    document.getElementById("editP2pDate").value = item.date || "";
    document.getElementById("editP2pBuyPrice").value = String(Number(item.buyPrice || 0));
    document.getElementById("editP2pCapacityClp").value = Math.round(Number(item.capacityClp || item.totalCost || 0)).toLocaleString("es-CL");
    document.getElementById("editP2pUsdt").value = p2pCapMoney(item.usdtAmount, 2);
    document.getElementById("editP2pPaid").value = String(Number(item.paidClp || item.manualPaymentClp || item.manualPaymentsClp || 0));
    document.getElementById("editP2pReference").value = item.reference || "";
    document.getElementById("editP2pNote").value = item.note || "";

    modal.classList.add("open");
    modal.style.zIndex = "10001";
  }

  function updateP2PCapacityEditUsdtPreview(){
    const clp = p2pCapNumber(document.getElementById("editP2pCapacityClp")?.value);
    const price = p2pCapNumber(document.getElementById("editP2pBuyPrice")?.value);
    const usdtEl = document.getElementById("editP2pUsdt");
    if(usdtEl){
      usdtEl.value = price > 0 ? p2pCapMoney(clp / price, 2) : "0.00";
    }
  }

  window.deleteP2PCapacity = function(id, confirmed){
    if(!confirmed){
      openP2PCapacityDeleteModal(id);
      return;
    }

    closeP2PCapacityDeleteModal();

    const completedModalWasOpen = !!document.getElementById("completedCapacitiesModal");

    delete window.__p2pCapacityPendingSync[id];

    const items = loadP2PCapacity().filter(item => item.id !== id);
    window.__p2pCapacityCache = items;
    // Ver el mismo comentario en saveP2PCapacity() -- un fallo acá (localStorage
    // lleno) no puede impedir que se termine de borrar/repintar.
    try{ localStorage.setItem(CAPACITY_KEY, JSON.stringify(items)); }catch(e){ console.warn('No se pudo guardar capacity en localStorage (no crítico):', e.message); }

    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();

    if(completedModalWasOpen && typeof openCompletedCapacitiesModal === "function"){
      document.getElementById("completedCapacitiesModal")?.remove();
      openCompletedCapacitiesModal();
    }

    (function retryDelete(did, attempt){
      fetch('/api/p2p/capacity?id=' + encodeURIComponent(did) + '&confirm=manual', {
        method: 'DELETE',
        credentials: 'include'
      })
      .then(res => {
        if(!res.ok) throw new Error("Error servidor: " + res.status);
        if(typeof showToast === "function") showToast("Capacity P2P eliminado");
      })
      .catch(e => {
        console.warn('Error delete capacity (intento '+(attempt+1)+'):', e);
        if(attempt < 2){
          setTimeout(function(){ retryDelete(did, attempt+1); }, 2000);
        } else {
          if(typeof showToast === "function") showToast("❌ No se pudo eliminar del servidor: " + e.message);
        }
      });
    })(id, 0);
  };

  window.finishP2PCapacity = async function(id){
    const items = loadP2PCapacity().slice();
    const item = items.find(cap => cap.id === id);

    if(!item){
      onzeAlert("No encontré este capacity.");
      return;
    }

    const stats = calculateP2PCapacityStats();
    const current = stats.capacities.find(cap => cap.id === id);

    const remaining = Number(current?.remainingUsdt || 0);
    const sold = Number(current?.usedUsdt || 0);
    const profit = Number(current?.profitClp || 0);

    const ok = await onzeConfirm(
      `¿Finalizar este capacity?\n\n` +
      `Vendido asignado: ${p2pCapMoney(sold, 2)} USDT\n` +
      `Restante: ${p2pCapMoney(remaining, 2)} USDT\n` +
      `Ganancia calculada: ${profit >= 0 ? "+" : "-"}${p2pCapMoney(Math.abs(profit), 0)} CLP\n\n` +
      `Si queda un restante pequeño, quedará guardado como residual del ciclo.`
    );

    if(!ok) return;

    item.status = "finished";
    item.finishedAt = new Date().toISOString();

    item.finalSoldUsdt = sold;
    item.finalRemainingUsdt = remaining;
    item.finalClpReceived = Number(current?.clpReceived || 0);
    item.finalCommissionUsdt = Number(current?.commissionUsdt || 0);
    item.finalCommissionClp = Number(current?.commissionClp || 0);
    item.finalProfitClp = profit;
    item.finalProfitUsdt = Number(current?.profitUsdt || 0);
    item.finalProfitPct = Number(current?.profitPct || 0);
    item.finalSaleParts = Array.isArray(current?.saleParts) ? current.saleParts : [];

    saveP2PCapacity(items);
    postP2PCapacityToServer(item);

    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();
    if(typeof botUpdateBuyPrice === 'function'){
      botUpdateBuyPrice();
    }

    if(typeof showToast === "function"){
      showToast("Capacity P2P finalizado");
    }
  };

  function p2pFormatAssignedSaleDate(part){
    const raw = part?.createdAt || "";
    if(!raw) return "Fecha no disponible";

    const d = new Date(raw);
    if(Number.isNaN(d.getTime())) return "Fecha no disponible";

    return d.toLocaleString("es-CL", {
      timeZone:"America/Santiago",
      day:"2-digit",
      month:"2-digit",
      year:"numeric",
      hour:"2-digit",
      minute:"2-digit"
    });
  }

  function p2pShortOrderNumber(orderNumber){
    const txt = String(orderNumber || "");
    if(!txt) return "Sin número";
    return txt.length > 10 ? "..." + txt.slice(-10) : txt;
  }

  window.resolveP2PUnassignedAsNewCapacity = function(){
    const stats = calculateP2PCapacityStats();

    if(Number(stats.unassignedSaleUsdt || 0) <= 0){
      onzeAlert("No hay ventas sin capacity para resolver.");
      return;
    }

    openP2PCapacityModal();

    // Bug real confirmado (ago 2026): una compra registrada con la fecha de
    // HOY (default del modal) no puede cubrir ventas de días anteriores --
    // el emparejamiento respeta fecha operativa (ver calculateP2PCapacityStats,
    // capStartTs > saleTs se salta). Si se abre desde este aviso, se
    // precarga con la fecha de la venta sin asignar MÁS ANTIGUA (no hoy) y
    // el monto CLP pendiente, para que la compra sí la absorba.
    const detail = Array.isArray(stats.unassignedSaleDetail) ? stats.unassignedSaleDetail : [];
    if(detail.length){
      const oldest = detail.reduce((a, b) => (Number(a.ts || 0) <= Number(b.ts || 0) ? a : b));
      if(oldest?.date){
        const dateEl = document.getElementById("p2pCapacityDate");
        if(dateEl) dateEl.value = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(oldest.date));
      }
    }
    const clpEl = document.getElementById("p2pCapacityClp");
    if(clpEl && Number(stats.unassignedSaleClp || 0) > 0){
      clpEl.value = Math.round(Number(stats.unassignedSaleClp)).toLocaleString("es-CL");
    }
  };

  window.resolveP2PUnassignedAsOwnCapital = async function(){
    const stats = calculateP2PCapacityStats();
    const excessUsdt = Number(stats.unassignedSaleUsdt || 0);
    const excessClp = Number(stats.unassignedSaleClp || 0);
    const excessCommissionUsdt = Number(stats.unassignedCommissionUsdt || 0);
    const detail = Array.isArray(stats.unassignedSaleDetail) ? stats.unassignedSaleDetail : [];

    if(excessUsdt <= 0 || !detail.length){
      onzeAlert("No hay ventas sin capacity para marcar como capital propio.");
      return;
    }

    const ok = await onzeConfirm(
      `¿Marcar estas ventas sin capacity como saldo/capital P2P propio?\n\n` +
      `USDT vendido sin capacity: ${p2pCapMoney(excessUsdt, 2)} USDT\n` +
      `CLP recibido aproximado: ${p2pCapMoney(excessClp, 0)} CLP\n` +
      `Comisión Binance: ${p2pCapMoney(excessCommissionUsdt, 4)} USDT\n` +
      `(${detail.length} venta(s))\n\n` +
      `Esto significa que no pertenece a un proveedor externo, y estas ventas puntuales ` +
      `NUNCA se le van a asignar a ningún capacity (nuevo o viejo), en ningún dispositivo.`
    );

    if(!ok) return;

    // Bug real confirmado en vivo (sep 2026): la versión vieja de esto solo
    // guardaba un TOTAL agregado en localStorage -- no vivía en el servidor
    // (cada dispositivo veía algo distinto) y no excluía las ventas
    // puntuales del reparto real, así que al crear un capacity nuevo esas
    // mismas ventas se le volvían a asignar como ganancia "nueva". Ahora se
    // manda cada orden puntual a Neon (P2PCapitalMarkedSale) -- ver
    // calculateP2PCapacityStats(), que las excluye por completo del reparto
    // en cuanto llegan acá, en cualquier dispositivo.
    const items = detail.map(d => ({
      orderNumber: d.orderNumber,
      exchange: d.exchange || "binance",
      amount: Number(d.usdt || 0),
      totalPrice: Number(d.clp || 0),
      commission: 0,
      executedAt: d.date || new Date().toISOString(),
    }));

    try {
      const res = await fetch('/api/p2p/capital-marked-sale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => null);
      if(!res.ok || !data?.ok){
        throw new Error(data?.error || res.statusText || 'Error servidor');
      }
    } catch(e) {
      onzeAlert('⚠️ No se pudo guardar en el servidor: ' + (e?.message || e) + '\n\nNo se marcó nada -- probá de nuevo.');
      return;
    }

    for(const it of items) window.__p2pCapitalMarkedOrderNumbers.set(it.orderNumber, it.totalPrice);

    if(typeof showToast === "function"){
      showToast("Ventas sin capacity marcadas como capital propio (guardado en servidor)");
    }else{
      onzeAlert("Ventas sin capacity marcadas como capital propio.");
    }

    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();
  };

  function findCapacityPanel(){
    return Array.from(document.querySelectorAll(".p2p-dashboard-panel"))
      .find(panel => panel.innerText.includes("Capacity externo P2P"));
  }

  window.renderP2PCapacityPanel = function renderP2PCapacityPanel(){
    const panel = findCapacityPanel();
    if(!panel) return;

    // Fix real (sep 2026): esta pestaña dependía de que el usuario TAMBIÉN
    // hubiera abierto alguna de las pestañas de Ventas (Binance/Bybit/OKX)
    // para que las ventas reales y manuales se sincronizaran desde Neon --
    // si nunca las abría, el cálculo de capacity trabajaba con lo que
    // hubiera quedado en el navegador de sesiones anteriores. Cuando por
    // fin llegaba data nueva (ej. al abrir esa otra pestaña días después),
    // capacities viejos se completaban de golpe con la fecha de HOY en vez
    // de su fecha real (confirmado en vivo: 16 capacities del 03-sep
    // completados así recién el 16-sep). Ahora esta pestaña se mantiene al
    // día por sí sola. Throttle de 10s (no en cada render, que puede
    // llamarse varias veces seguidas tras una acción) para no saturar el
    // servidor.
    // Bug real confirmado en vivo (sep 2026, dinero real afectado -- ver
    // AGENTS.md): acá abajo se disparaban las 3 sincronizaciones de arriba
    // y, EN LA MISMA LÍNEA SIGUIENTE, se llamaba a autoFinishP2PCapacities()
    // sin esperar ninguna de ellas -- como fetch() es asíncrono, la decisión
    // de "¿este capacity ya se llenó?" se tomaba con los datos VIEJOS que
    // ya estaban en el navegador, exactamente en el instante en que los
    // datos frescos venían en camino pero todavía no habían llegado. Ahora
    // se espera (Promise.all) a que las 3 terminen antes de decidir -- el
    // cierre automático sigue siendo automático (nadie tiene que tocar
    // nada), solo que ahora mira los datos más frescos posibles antes de
    // cerrar algo, en vez de una foto vieja de la pestaña.
    const __now = Date.now();
    if(!window.__p2pCapacitySalesSyncLastAt || __now - window.__p2pCapacitySalesSyncLastAt > 10000){
      window.__p2pCapacitySalesSyncLastAt = __now;
      // ONZE y ZINPLE, no solo la etiqueta activa -- el capacity es de toda
      // la cuenta (ver comentario junto a syncAllLabelsBinanceSalesForCapacity).
      const __freshSyncs = [];
      if(typeof syncAllLabelsBinanceSalesForCapacity === 'function') __freshSyncs.push(syncAllLabelsBinanceSalesForCapacity());
      if(typeof syncBybitSales === 'function') __freshSyncs.push(syncBybitSales(true));
      if(typeof window.syncP2PManualSalesFromServer === 'function') __freshSyncs.push(window.syncP2PManualSalesFromServer());
      Promise.all(__freshSyncs).catch(() => {}).then(() => {
        if(typeof autoFinishP2PCapacities === "function") autoFinishP2PCapacities();
      });
    } else if(typeof autoFinishP2PCapacities === "function"){
      // Ya se sincronizó hace menos de 10s (throttle de arriba) -- los datos
      // siguen razonablemente frescos, se puede decidir con lo que ya hay.
      autoFinishP2PCapacities();
    }

    const stats = calculateP2PCapacityStats();
    const items = stats.capacities;

    // Numeración global: el orden real de creación no cambia cuando uno se completa.
    const globalOrder = {};
    items.slice().sort((a,b) => {
      const ad = new Date(a.date || a.createdAt || 0).getTime();
      const bd = new Date(b.date || b.createdAt || 0).getTime();
      return ad - bd;
    }).forEach((c, i) => { globalOrder[c.id] = i + 1; });

    // Orden fijo: más antiguo primero. Sin prioridad por "movimiento" para que no se reordenen solas.
    const displayItems = items.filter(c => c.status !== "finished" && c.status !== "_capital").slice().sort((a,b) => {
      const ad = new Date(a.date || a.createdAt || 0).getTime();
      const bd = new Date(b.date || b.createdAt || 0).getTime();
      return ad - bd;
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <h3 class="section-title" style="margin-bottom:8px;">Capacity externo P2P</h3>
          <p class="section-text">Proveedor, cupo, precio de compra, pagos realizados y saldo pendiente.</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn" type="button" id="openP2PCapacityBtn">Registrar capacity</button>
          <button class="btn secondary" type="button" id="openCompletedCapacitiesBtn" onclick="openCompletedCapacitiesModal()">📋 Completados</button>
          ${!window.HAS_ONZE_CORE_BUSINESS ? (() => {
            // Precarga con el último valor conocido (cache en memoria) en vez
            // de arrancar siempre en "···"/0% -- pedido explícito del
            // usuario: el re-render cada ~15s del panel recreaba este botón
            // de cero, así que la barra se vaciaba y se volvía a llenar cada
            // vez que llegaba la respuesta fresca (parpadeo molesto). Con la
            // cache, el re-render arranca ya mostrando lo último que se supo
            // -- la consulta fresca solo la actualiza si cambió de verdad.
            const cached = window.__p2pBankQuotaCache;
            const badgeText = cached ? `${p2pCapMoney(cached.total, 0)}/${p2pCapMoney(cached.limit, 0)}` : "···";
            const pct = cached && cached.limit > 0 ? Math.min(100, (cached.total / cached.limit) * 100) : 0;
            const color = pct >= 100 ? "#fb7185" : pct >= 80 ? "#fbbf24" : "#34d399";
            return `
            <button class="btn secondary" type="button" onclick="window.p2pOpenBankQuotaModal()" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;white-space:nowrap;flex-shrink:0;min-width:150px;">
              <span style="display:flex;align-items:center;gap:6px;">
                🏦 Banco Estado
                <span id="p2pBankQuotaBadge" style="font-size:11px;font-weight:700;color:${cached ? color : "#8aa0ba"};">${badgeText}</span>
              </span>
              <span style="width:100%;height:5px;border-radius:4px;background:rgba(148,163,184,.2);overflow:hidden;">
                <span id="p2pBankQuotaBadgeBar" style="display:block;height:100%;width:${pct}%;background:${color};transition:width .3s;"></span>
              </span>
            </button>
          `; })() : ""}
        </div>
      </div>

      <div class="p2p-capacity-mini-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">
        <div class="p2p-capacity-mini">
          <span>Total USDT a recibir</span>
          <strong>${p2pCapMoney(stats.totalCapacityUsdt || 0, 2)} USDT</strong>
          <div class="p2p-capacity-meta" style="margin-top:8px;">
            Recibido: ${p2pCapMoney(stats.smartReceivedUsdt || 0, 2)} USDT
          </div>
          <div class="p2p-capacity-meta" style="margin-top:3px;">
            Restante: ${p2pCapMoney(stats.remainingCapacityUsdt || 0, 2)} USDT
          </div>
        </div>

        <div class="p2p-capacity-mini">
          <span>Total proveedor</span>
          <strong>${p2pCapMoney(stats.totalCapacityCostClp || 0, 0)} CLP</strong>
          <div class="p2p-capacity-meta" style="margin-top:8px;">
            Recibido: ${p2pCapMoney(stats.smartCoveredClp || 0, 0)} CLP
          </div>
          <div class="p2p-capacity-meta" style="margin-top:3px;">
            Restante: ${p2pCapMoney(stats.pendingProviderClp || 0, 0)} CLP
          </div>
        </div>
      </div>

      ${
        !displayItems.length && Number(stats.unassignedSaleUsdt || 0) > 0
          ? `<div class="p2p-capacity-card" style="margin-top:12px;border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.07);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                <div>
                  <div class="p2p-capacity-title" style="color:#fbbf24;">Ventas sin compra/capacity detectadas</div>
                  <div class="p2p-capacity-meta" style="margin-top:5px;">
                    Hay ${p2pCapMoney(stats.unassignedSaleUsdt, 2)} USDT vendidos que todavía no tienen una compra/capacity asignada.
                  </div>
                  <div class="p2p-capacity-meta" style="margin-top:5px;">
                    CLP recibido aprox: ${p2pCapMoney(stats.unassignedSaleClp, 0)} CLP · Comisión: ${p2pCapMoney(stats.unassignedCommissionUsdt, 4)} USDT
                  </div>
                  <div class="p2p-capacity-meta" style="margin-top:7px;color:#facc15;">
                    Importante: al registrar la compra, ponle como fecha el día de la venta MÁS ANTIGUA de la lista de abajo (no hoy) -- una compra fechada hoy no puede cubrir ventas de días anteriores.
                  </div>
                </div>

                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                  <button class="btn" type="button" onclick="resolveP2PUnassignedAsNewCapacity()">Registrar compra</button>
                  <button class="btn secondary" type="button" onclick="resolveP2PUnassignedAsOwnCapital()" title="Úsalo cuando la venta es de antes de tener un capacity/proveedor registrado y no sabes el costo real de compra">Marcar como capital propio</button>
                </div>
              </div>
              ${
                Array.isArray(stats.unassignedSaleDetail) && stats.unassignedSaleDetail.length
                  ? `<div style="margin-top:12px;border-top:1px solid rgba(251,191,36,.2);padding-top:10px;">
                      <div class="p2p-capacity-meta" style="color:#facc15;margin-bottom:6px;">Venta(s) sin asignar (${stats.unassignedSaleDetail.length}):</div>
                      ${stats.unassignedSaleDetail.slice(0, 20).map(d => {
                        const dateStr = d.date ? new Date(d.date).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "(sin fecha)";
                        // Registro fantasma con 0 USDT/0 CLP -- no aporta nada a
                        // ningún cálculo, seguro de borrar sin importar si vino de
                        // una venta manual o de una orden real de Binance/Bybit/OKX.
                        // Para una venta con valor real solo se puede borrar si es
                        // manual (dato que el usuario mismo tipeó) -- una orden real
                        // con monto real nunca se borra silenciosamente, hay que
                        // resolverla con "Registrar compra" o "Marcar como capital
                        // propio" para no perder el rastro de esa plata.
                        const isPhantom = window.isP2POrderPhantom({ amount: d.usdt, totalPrice: d.clp });
                        const canDelete = d.isManual || isPhantom;
                        return `<div class="p2p-capacity-meta" style="font-family:monospace;font-size:12px;margin-top:3px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                          <span>${dateStr} · ${d.exchange}${d.isManual ? " (manual)" : ""} · ${p2pCapMoney(d.usdt, 2)} USDT / ${p2pCapMoney(d.clp, 0)} CLP · orden: ${d.orderNumber || "(sin número)"}</span>
                          ${canDelete ? `<button class="btn small danger" type="button" onclick="window.deleteP2PUnassignedManualSale('${d.orderNumber}','${d.exchange}',${d.isManual ? 'true' : 'false'})" title="Borrar este registro (ej: si es basura sin monto real)" style="padding:2px 6px;font-size:12px;line-height:1;flex-shrink:0;">🗑️</button>` : ""}
                        </div>`;
                      }).join("")}
                    </div>`
                  : ""
              }
            </div>`
          : ""
      }

      <div class="p2p-capacity-list">
        ${
          !displayItems.length
          ? `<div class="p2p-dashboard-empty">Sin capacity externo registrado todavía.</div>`
          : displayItems.map((item, index) => `
            <div class="p2p-capacity-card">
              <div class="p2p-capacity-top" style="align-items:flex-start;">
                <div style="width:100%;">
                  <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:center;">
                    <div class="p2p-capacity-title" style="font-size:15px;line-height:1.2;">#${globalOrder[item.id] || index + 1} · ${item.provider || "Proveedor"}</div>

                    <div class="p2p-capacity-meta" style="font-size:14px;text-align:center;font-weight:950;color:#a8b3c7;">
                      ${item.date || ""}
                    </div>

                    <span style="display:inline-flex;align-items:center;gap:6px;">
                      <span style="display:inline-flex;justify-content:center;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:950;color:${item.status === "finished" ? "#94a3b8" : "#34d399"};background:${item.status === "finished" ? "rgba(148,163,184,.10)" : "rgba(52,211,153,.12)"};border:1px solid ${item.status === "finished" ? "rgba(148,163,184,.20)" : "rgba(52,211,153,.26)"};">
                        ${item.status === "finished" ? "Finalizado" : "Activo"}
                      </span>
                      <button class="p2p-action-icon-btn" type="button" title="Editar capacity" aria-label="Editar capacity" onclick="openP2PCapacityEditModal('${item.id}')" style="width:30px;height:30px;">
                        <svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                      </button>
                    </span>
                  </div>

                  <div style="margin-top:16px;display:grid;gap:7px;">
                    <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
                      Capacity: <span style="color:#f8fafc;font-size:15px;font-weight:950;">${p2pCapMoney(item.totalCost, 0)} CLP</span>
                    </div>

                    <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
                      Tasa: <span style="color:#f8fafc;font-size:15px;font-weight:950;">${p2pCapMoney(item.buyPrice, 2)} CLP/USDT</span>
                    </div>

                    <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
                      USDT a recibir: <span style="color:#34d399;font-size:15px;font-weight:950;">${p2pCapMoney(Number(item.clpReceived || 0) / Number(item.buyPrice || 1), 2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="p2p-capacity-mini-grid">
                <div class="p2p-capacity-mini">
                  <span>Usado ventas</span>
                  <strong>${p2pCapMoney(item.usedUsdt, 2)} USDT</strong>
                </div>
                <div class="p2p-capacity-mini">
                  <span>Restante</span>
                  <strong>${p2pCapMoney(item.remainingUsdt, 2)} USDT</strong>
                  <div class="p2p-capacity-meta" style="margin-top:4px;">${p2pCapMoney(item.pendingClp, 0)} CLP</div>
                </div>
                <div class="p2p-capacity-mini">
                  <span>CLP recibido</span>
                  <strong>${p2pCapMoney(item.clpReceived, 0)} CLP</strong>
                </div>
                <div class="p2p-capacity-mini">
                  <span>Costo usado</span>
                  <strong>${p2pCapMoney(item.usedCost, 0)} CLP</strong>
                </div>
                <div class="p2p-capacity-mini">
                  <span>Comisión</span>
                  <strong>${p2pCapMoney(item.commissionUsdt, 2)} USDT</strong>
                </div>
                <div class="p2p-capacity-mini">
                  <span>Mín. venta</span>
                  <strong style="color:#facc15;">${(()=>{
                    const bp = Number(item.buyPrice || 0);
                    const pct = 0.0014;
                    return p2pCapMoney(1 - pct > 0 ? bp / (1 - pct) : bp, 2);
                  })()} CLP</strong>
                </div>
                ${
                  Number(item.manualPaymentClp || item.manualPaymentsClp || item.paidClp || 0) > 0
                  ? `<div class="p2p-capacity-mini" style="cursor:pointer;" onclick="window.openManualPaymentsModal('${item.id}')" title="Click para ver el detalle de cada pago">
                      <span>Pago manual ›</span>
                      <strong style="color:#fbbf24;">${p2pCapMoney(Number(item.manualPaymentClp || item.manualPaymentsClp || item.paidClp || 0), 0)} CLP</strong>
                    </div>`
                  : ""
                }
                <div class="p2p-capacity-mini">
                  <span>Ganancia</span>
                  <strong style="color:${item.profitUsdt >= 0 ? "#34d399" : "#fb7185"};">${item.profitUsdt >= 0 ? "+" : "-"}${p2pCapMoney(Math.abs(item.profitUsdt), 2)} USDT</strong>
                  <div class="p2p-capacity-meta" style="margin-top:4px;">${item.profitClp >= 0 ? "+" : "-"}${p2pCapMoney(Math.abs(item.profitClp), 0)} CLP</div>
                </div>
              </div>

              ${item.finishedAt ? `<div class="p2p-capacity-meta" style="margin-top:10px;">Finalizado: ${new Date(item.finishedAt).toLocaleString("es-CL", { timeZone:"America/Santiago", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}</div>` : ""}

              <div class="p2p-capacity-actions-row">
                <button class="p2p-action-icon-btn" type="button" title="Ver detalle" aria-label="Ver detalle" onclick="openP2PCapacityDetail('${item.id}')">
                  <svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>
                </button>
                ${
                  item.status === "finished"
                    ? `<button class="btn secondary" type="button" disabled>Completado</button>`
                    : `<button class="p2p-action-main-btn" type="button" onclick="openCompleteCapacityModal('${item.id}')" title="Completar saldo pendiente del capacity">
                         <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
                         <span>Completar saldo</span>
                       </button>`
                }
                <button class="p2p-action-icon-btn danger" type="button" onclick="deleteP2PCapacity('${item.id}')" title="Eliminar" aria-label="Eliminar">
                  <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                </button>
              </div>
            </div>
          `).join("")
        }
      </div>
    `;

    document.getElementById("openP2PCapacityBtn")?.addEventListener("click", openP2PCapacityModal);

    // Pedido explícito del usuario (ago 2026): que el cupo de Banco Estado
    // se vea también AFUERA del botón (no solo al abrir el modal), sumando
    // en vivo. Bug real confirmado en vivo: llamar a p2pRefreshBankQuotaBadge()
    // acá directo (en cada render) quedaba en una carrera -- panel.innerHTML
    // reemplaza el DOM y crea un <span> NUEVO en cada render, pero la
    // consulta anterior (que tarda 2.5-5s por ser en vivo contra Binance)
    // seguía en vuelo apuntando al <span> VIEJO ya desconectado del DOM, así
    // que su resultado nunca se veía y el badge quedaba pegado en "···" para
    // siempre. Por eso el refresco ahora vive en un intervalo propio,
    // arrancado UNA sola vez (idempotente), totalmente aparte del ciclo de
    // renders de este panel.
    if(!window.HAS_ONZE_CORE_BUSINESS && typeof window.p2pEnsureBankQuotaPolling === "function"){
      window.p2pEnsureBankQuotaPolling();
    }
  }

  const P2P_INITIAL_CAPITAL_KEY = "onze_p2p_initial_capital_usdt" + (window.__p2pTenantSuffix || "");
  const P2P_PROFIT_DAY_KEY = "onze_p2p_profit_day" + (window.__p2pTenantSuffix || "");
  const P2P_PROFIT_START_KEY = "onze_p2p_profit_start" + (window.__p2pTenantSuffix || "");

  function getP2PInitialCapital(){
    return Number(localStorage.getItem(P2P_INITIAL_CAPITAL_KEY) || 0);
  }

  window.saveP2PInitialCapital = function saveP2PInitialCapital(value){
    localStorage.setItem(P2P_INITIAL_CAPITAL_KEY, String(Number(value || 0)));
  }

  async function syncP2PInitialCapitalToServer(value){
    try{
      const res = await fetch("/api/p2p/initial-capital", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({value}),
      });
      const data = await res.json();
      if(!data.ok){
        console.warn("Error sync capital al servidor:", data.error);
        return;
      }
      // Un ajuste manual resetea la ganancia acumulada a 0 en el servidor
      // (ver /api/p2p/initial-capital) -- se refleja acá también para que
      // la tarjeta no siga sumando la acumulada vieja encima del nuevo
      // valor hasta el próximo refresco de página.
      window.__p2pAccumulatedProfitUsdt = Number(data.accumulatedProfit || 0);
      updateP2PCapitalCard();
    }catch(e){
      console.warn("Error sync capital al servidor:", e);
    }
  }

  // Ganancia acumulada de meses YA TERMINADOS -- separada del capital
  // inicial (que queda FIJO para siempre, pedido explícito del usuario ago
  // 2026) y de la ganancia de ESTE MES (que sí se resetea a 0 cada mes).
  // Capital P2P = inicial + acumulada + este mes. Ver
  // p2pMonthlyCapitalRollover() más abajo, que es quien la va sumando.
  window.__p2pAccumulatedProfitUsdt = 0;
  window.loadP2PInitialCapitalFromServer = async function loadP2PInitialCapitalFromServer(){
    try{
      const res = await fetch("/api/p2p/initial-capital");
      const data = await res.json();
      if(data.ok && typeof data.value === "number" && data.value >= 0){
        window.__p2pAccumulatedProfitUsdt = Number(data.accumulatedProfit || 0);
        window.__p2pWithdrawalsBaselineAt = data.withdrawalsBaselineAt || null;
        window.recomputeP2PTotalWithdrawn();
        const local = getP2PInitialCapital();
        if(Math.abs(data.value - local) > 0.01){
          localStorage.setItem(P2P_INITIAL_CAPITAL_KEY, String(data.value));
        }
        updateP2PCapitalCard();
      }
    }catch(e){
      // silent — server may not have it yet
    }
  }

  // Botón "Empezar de cero" (ago 2026, pedido explícito del usuario tras un
  // retiro del mes anterior): un retiro de ANTES de este punto de corte ya
  // quedó reflejado en el capital inicial (fue lo que lo bajó) -- restarlo
  // otra vez en vivo sería descontarlo dos veces. Solo los retiros de esta
  // fecha en adelante cuentan. null = nunca se reseteó, cuenta TODO el
  // historial (comportamiento de siempre). Se recalcula acá (no solo al
  // cargar los retiros) porque el punto de corte y la lista de retiros
  // llegan de dos fetches independientes, en cualquier orden.
  window.__p2pWithdrawalsBaselineAt = null;
  window.recomputeP2PTotalWithdrawn = function(){
    const raw = window.__p2pWithdrawalsRaw || [];
    const baselineMs = window.__p2pWithdrawalsBaselineAt ? new Date(window.__p2pWithdrawalsBaselineAt).getTime() : 0;
    window.__p2pTotalWithdrawnUsdt = raw.reduce((sum, w) => {
      const t = w.withdrawnAt ? new Date(w.withdrawnAt).getTime() : 0;
      return t >= baselineMs ? sum + Number(w.amountUsdt) : sum;
    }, 0);
  };

  // Pedido explícito del usuario (ago 2026): mismo mecanismo de Retiros y
  // gastos que ya tiene el socio, ahora para el Capital P2P propio de ONZE.
  // Cacheado en window.__p2pTotalWithdrawnUsdt (todo el historial desde el
  // punto de corte de arriba) -- updateP2PCapitalCard() y el modal de
  // Métricas P2P lo restan del capital mostrado.
  window.__p2pTotalWithdrawnUsdt = 0;
  window.loadP2PWithdrawalsFromServer = async function loadP2PWithdrawalsFromServer(){
    try{
      const res = await fetch("/api/p2p/withdrawals");
      const data = await res.json();
      if(data.ok){
        // Lista cruda -- la usa "Ganancia neta a repartir" para descontarle
        // a cada persona lo que ella misma ya retiró en el rango (solo
        // tenant de Hector, ver el resto del comentario en
        // renderP2PRangeDetailContent) -- y recomputeP2PTotalWithdrawn()
        // para el total filtrado por el punto de corte.
        window.__p2pWithdrawalsRaw = data.withdrawals || [];
        window.recomputeP2PTotalWithdrawn();
        updateP2PCapitalCard();
      }
    }catch(e){
      // silent
    }
  }

  // Pedido explícito del usuario (ago 2026), confirmado con un ejemplo
  // numérico: "Capital P2P" = inicial (FIJO para siempre) + ganancia
  // acumulada de meses YA TERMINADOS + ganancia de ESTE MES (en vivo, sube
  // con cada orden). Al pasar de mes, la ganancia de ese mes se suma a la
  // ACUMULADA (nunca al inicial) y "este mes" vuelve a 0 -- el total
  // (Capital P2P) no baja, porque lo que se resetea ya quedó guardado en
  // la acumulada un instante antes.
  //
  // Guarda en el servidor (campo "date" del registro de capital inicial,
  // vía throughMonth) hasta qué mes ya quedó sumado a la acumulada. Corre
  // una vez al cargar el panel: si el mes guardado quedó atrás, suma la
  // ganancia de ESE mes completo (el que ya terminó) a la acumulada y
  // avanza el marcador -- nunca suma el mes actual (todavía en curso, ese
  // se sigue mostrando en vivo como "Este mes"). Si el usuario estuvo
  // varios meses sin abrir el panel, se pone al día de a un mes por carga,
  // no todo de una vez.
  window.p2pMonthlyCapitalRollover = async function p2pMonthlyCapitalRollover(){
    try{
      const res = await fetch("/api/p2p/initial-capital");
      const data = await res.json();
      if(!data.ok) return;
      const currentMonth = p2pChileMonthKey(new Date());

      if(!data.throughMonth){
        // Primera vez que corre este mecanismo para este tenant -- se
        // marca el mes actual como punto de partida SIN sumar nada a la
        // acumulada, para no sumar de golpe todo el historial hasta ahora.
        await fetch("/api/p2p/initial-capital", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ throughMonth: currentMonth, accumulatedProfit: Number(data.accumulatedProfit || 0) }),
        });
        return;
      }

      const [y, m] = data.throughMonth.split("-").map(Number);
      const rollDate = new Date(y, m, 1); // m ya es 1-indexado del string -> cae en el mes siguiente
      const rollMonth = `${rollDate.getFullYear()}-${String(rollDate.getMonth() + 1).padStart(2, "0")}`;
      if(rollMonth >= currentMonth) return; // al día -- nada terminado que sumar todavía

      const monthStart = rollMonth + "-01";
      const monthEndDate = new Date(rollDate.getFullYear(), rollDate.getMonth() + 1, 0);
      const monthEnd = p2pChileDayKey(monthEndDate) || monthEndDate.toISOString().slice(0, 10);

      const stats = calculateP2PCapacityStats();
      const savedFrom = window.__p2pCustomFrom, savedTo = window.__p2pCustomTo;
      window.__p2pCustomFrom = monthStart;
      window.__p2pCustomTo = monthEnd;
      const monthData = getP2PRangeStatsFromCapacity(stats, "custom");
      window.__p2pCustomFrom = savedFrom;
      window.__p2pCustomTo = savedTo;

      const profitUsdt = Number(monthData.profitUsdt || 0);
      const newAccumulated = Number(data.accumulatedProfit || 0) + profitUsdt;

      const postRes = await fetch("/api/p2p/initial-capital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ throughMonth: rollMonth, accumulatedProfit: newAccumulated }),
      });
      const postData = await postRes.json();
      if(postData.ok){
        window.__p2pAccumulatedProfitUsdt = Number(postData.accumulatedProfit || 0);
        updateP2PCapitalCard();
        if(profitUsdt !== 0 && typeof showToast === "function"){
          showToast(`Capital P2P: se sumó la ganancia de ${rollMonth} (mes ya terminado)`);
        }
      }
    }catch(e){
      console.warn("Error en rollover mensual de capital P2P:", e);
    }
  }

  function getP2PTodayProfit(cumulativeProfit){
    const today = new Date().toLocaleDateString("es-CL", { timeZone:"America/Santiago" });
    const savedDay = localStorage.getItem(P2P_PROFIT_DAY_KEY) || "";

    if(savedDay !== today){
      localStorage.setItem(P2P_PROFIT_DAY_KEY, today);
      localStorage.setItem(P2P_PROFIT_START_KEY, String(cumulativeProfit));
      return 0;
    }

    const startProfit = Number(localStorage.getItem(P2P_PROFIT_START_KEY) || 0);
    return cumulativeProfit - startProfit;
  }

  function getP2PCompletedClpSalesForCapital(){
    try{
      return loadP2PBinanceOrders().filter(o => {
        const status = String(o.orderStatus || "").toUpperCase();
        const type = String(o.tradeType || "").toUpperCase();
        const fiat = String(o.fiat || "").toUpperCase();
        return status === "COMPLETED" && type === "SELL" && fiat === "CLP";
      });
    }catch(e){
      return [];
    }
  }

  function getP2PAvgSellPriceForCapital(){
    const sales = getP2PCompletedClpSalesForCapital();
    const totalUsdt = sales.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const totalClp = sales.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);
    return totalUsdt > 0 ? totalClp / totalUsdt : 0;
  }

  // BUG REAL encontrado y eliminado (ago 2026): acá vivía carryOverP2PCapital(),
  // pensada para que la ganancia acumulada no se perdiera al pasar de mes,
  // pero guardaba el "arrastre" SOLO en localStorage (nunca en el
  // servidor) -- cada recarga de página, loadP2PInitialCapitalFromServer()
  // pisaba ese valor local con el del servidor, y al otro día esta función
  // volvía a sumar ganancia que el servidor nunca supo que ya se había
  // sumado antes, con riesgo de duplicarla. Reemplazada por
  // p2pMonthlyCapitalRollover() (ver más abajo), que guarda el progreso en
  // el servidor (campo "date" del registro de capital inicial) y solo
  // suma el mes que ya terminó, una sola vez.

  function calculateP2PProfitUsdtFromStats(stats){
    if(typeof stats?.realProfitUsdt === "number" && isFinite(stats.realProfitUsdt)){
      return stats.realProfitUsdt;
    }

    const avgSell = getP2PAvgSellPriceForCapital();
    const profitClp = Number(stats?.realProfitClp || 0);

    if(avgSell > 0 && profitClp){
      return profitClp / avgSell;
    }

    return 0;
  }

  // Caché de "ganancia de este mes" para la tarjeta Capital P2P -- pedido
  // explícito del usuario (sep 2026): esta función se llama desde 41
  // lugares distintos del panel (cada sync de ventas, cada acción, cada
  // 60s de fondo), y cada llamada recalculaba "Este mes" desde cero
  // recorriendo venta por venta TODO el mes en curso -- medido en vivo:
  // ~125ms por llamada en una PC rápida, varios segundos reales en un
  // celular de gama baja (Android, confirmado con la cuenta de Hector).
  //
  // La huella (fingerprint) de abajo se arma SOLO con los campos ya
  // agregados de cada capacity (clpReceived, usedUsdt, commissionUsdt,
  // buyPrice, provider, finishedAt) -- nunca con el detalle de saleParts.
  // Estos campos SIEMPRE se actualizan en el mismo momento que saleParts
  // (ver el bloque de asignación en calculateP2PCapacityStats, más arriba
  // en este archivo: cada vez que se agrega una parte a saleParts, se suma
  // a la vez a clpReceived/usedUsdt/commissionUsdt) -- por construcción,
  // si estos campos no cambiaron para NINGÚN capacity, el detalle tampoco
  // cambió, así que el resultado cacheado sigue siendo exactamente el
  // mismo que si se recalculara de cero. Se agrega también el mes actual
  // (hora Chile) para que el caché se invalide solo al cambiar de mes.
  let __p2pMonthProfitCache = { key: null, value: 0 };
  function p2pCapacitiesFingerprint(capacities){
    let fp = "";
    for(const c of (capacities || [])){
      fp += c.id + ":" + c.status + ":" + c.clpReceived + ":" + c.usedUsdt + ":" + c.commissionUsdt + ":" + c.buyPrice + ":" + c.provider + ":" + (c.finishedAt || "") + "|";
    }
    return fp;
  }

  window.updateP2PCapitalCard = function updateP2PCapitalCard(stats){
    const capitalEl = document.getElementById("p2pDashVolume");
    const subEl = document.getElementById("p2pDashVolumeSub");

    // Definición confirmada con el usuario (ago 2026), con un ejemplo
    // numérico verificado: Capital P2P = capital inicial (FIJO para
    // siempre, solo cambia si se edita a mano) + ganancia ACUMULADA de
    // meses YA TERMINADOS (ver p2pMonthlyCapitalRollover, la va sumando
    // sola sin tocar el inicial) + ganancia de ESTE MES calendario (en
    // vivo, sube con cada orden, se resetea a 0 al pasar de mes SIN que el
    // total baje, porque ya quedó guardada en la acumulada un instante
    // antes). NO volver a fusionar la acumulada con el inicial sin
    // confirmar con el usuario primero -- ya se probó y el inicial debe
    // quedar fijo siempre.
    const safeStats = stats || (typeof calculateP2PCapacityStats === "function" ? calculateP2PCapacityStats() : {});
    const monthCacheKey = p2pCapacitiesFingerprint(safeStats.capacities) + "|" + p2pChileMonthKey(new Date());
    let monthlyProfit;
    if(__p2pMonthProfitCache.key === monthCacheKey){
      monthlyProfit = __p2pMonthProfitCache.value;
    } else {
      monthlyProfit = Number(getP2PRangeStatsFromCapacity(safeStats, "month").profitUsdt || 0);
      __p2pMonthProfitCache = { key: monthCacheKey, value: monthlyProfit };
    }
    const accumulatedProfit = Number(window.__p2pAccumulatedProfitUsdt || 0);
    // Pedido explícito del usuario (ago 2026): igual que en el capital del
    // socio, cada retiro/gasto registrado resta al instante del total.
    const withdrawn = Number(window.__p2pTotalWithdrawnUsdt || 0);
    const total = getP2PInitialCapital() + accumulatedProfit + monthlyProfit - withdrawn;

    if(capitalEl){
      capitalEl.textContent = `${p2pCapMoney(total, 2)} USDT`;
    }

    if(subEl){
      const sign = monthlyProfit >= 0 ? "+" : "-";
      // Pedido explícito del usuario (ago 2026): la tarjeta resumen no
      // muestra "Acumulado" ni "Retirado" -- ambos siguen existiendo y
      // afectando el total de arriba (ver `total` más arriba), solo que acá
      // no se listan para mantenerla simple. El detalle de los retiros ya
      // se puede ver en la sección "Retiros y gastos" del modal de Métricas
      // P2P (renderP2PRangeDetailContent).
      subEl.innerHTML = `Inicial: <strong>${p2pCapMoney(getP2PInitialCapital(), 2)} USDT</strong><br>Este mes: ${sign}${p2pCapMoney(Math.abs(monthlyProfit), 2)} USDT`;
    }
  }

  // Pedido explícito del usuario (ago 2026, tenant de Hector): trackear el
  // cupo diario de recepción por Banco Estado (límite del banco, 5.000.000
  // CLP/día, no de Binance). Se reinicia solo al pasar de día en hora de
  // Chile (lo calcula el servidor, ver app/api/p2p/bank-quota/route.ts).
  // Escape local -- NO reusar escHtml, vive en otro bloque <script> distinto
  // de este (ver comentario "window.-scoped a propósito" más arriba en este
  // mismo archivo) y llamarlo acá tira un ReferenceError silencioso que caía
  // directo al catch de "Error cargando el cupo" (bug real confirmado en
  // vivo, ago 2026, tenant de Hector).
  function p2pBankQuotaEsc(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Pedido explícito del usuario (ago 2026): el detalle de retiros por
  // persona ("Ganancia neta a repartir") no debe expandir la tarjeta -- debe
  // abrir una pantalla aparte, igual que el modal de "Capital P2P". Modal
  // genérico, compartido entre la cuenta de Hector (ONZE) y AKI Transfers
  // (SOCIO, otro <script> distinto) -- por eso vive en window y no depende
  // de ninguna variable de otro bloque. Escape propio (no reusar escHtml/
  // p2pBankQuotaEsc de otros bloques) para poder llamarse desde cualquiera.
  function p2pPersonNetEsc(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.p2pOpenPersonNetModal = function(payload){
    let modal = document.getElementById("p2pPersonNetModal");
    if(!modal){
      modal = document.createElement("div");
      modal.id = "p2pPersonNetModal";
      modal.style.cssText = "position:fixed;inset:0;z-index:1000001;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;background:rgba(2,6,23,.72);backdrop-filter:blur(10px);";
      modal.addEventListener("mousedown", (e) => { if(e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    // payload.gananciaLabel / payload.emptyWithdrawalsLabel son opcionales
    // (pedido explícito del usuario, sep 2026, solo para AKI Transfers) --
    // este modal es COMPARTIDO con el dashboard P2P de otros tenants (ver
    // personRowP2P más abajo en el archivo), que sigue siendo por mes/rango
    // -- si no vienen, se usa el texto de siempre para no afectarlo.
    const rowsHtml = (payload.withdrawals && payload.withdrawals.length)
      ? payload.withdrawals.map((w) => `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13px;border-top:1px solid rgba(148,163,184,.08);">
          <span style="color:#8aa0ba;">Retiro · ${p2pPersonNetEsc(w.date)}${w.note ? " · " + p2pPersonNetEsc(w.note) : ""}</span>
          <span style="color:#fb7185;font-weight:700;white-space:nowrap;">-${p2pPersonNetEsc(w.amount)} USDT</span>
        </div>`).join("")
      : `<div style="padding:8px 0;font-size:13px;color:#64748b;">${p2pPersonNetEsc(payload.emptyWithdrawalsLabel || "Sin retiros en este rango.")}</div>`;
    modal.innerHTML = `
      <div style="width:min(420px,100%);border:1px solid rgba(52,211,153,.28);background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));border-radius:20px;padding:22px;position:relative;">
        <button type="button" onclick="document.getElementById('p2pPersonNetModal').remove()" title="Cerrar" aria-label="Cerrar" style="position:absolute;top:16px;right:16px;width:28px;height:28px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(148,163,184,.1);color:#cbd5e1;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
        <h3 style="color:#00d4ff;margin-bottom:14px;padding-right:30px;">👤 ${p2pPersonNetEsc(payload.name)}</h3>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
          <span style="color:#8aa0ba;">${p2pPersonNetEsc(payload.gananciaLabel || "Ganancia total del mes")}</span>
          <span style="color:#f8fafc;font-weight:700;">${p2pPersonNetEsc(payload.gananciaSign)}${p2pPersonNetEsc(payload.ganancia)} USDT</span>
        </div>
        ${rowsHtml}
        <div style="display:flex;justify-content:space-between;gap:10px;padding:12px 0 2px;font-size:14px;border-top:1px solid rgba(148,163,184,.14);margin-top:6px;">
          <span style="color:#cbd5e1;font-weight:800;">Total a recibir</span>
          <span style="color:${p2pPersonNetEsc(payload.color)};font-weight:900;white-space:nowrap;">${p2pPersonNetEsc(payload.sign)}${p2pPersonNetEsc(payload.share)} USDT · ${p2pPersonNetEsc(payload.sign)}${p2pPersonNetEsc(payload.shareClp)} CLP</span>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <button type="button" onclick="document.getElementById('p2pPersonNetModal').remove()" style="padding:9px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
      </div>
    `;
  };

  window.p2pOpenPersonNetModalFromEl = function(el){
    try {
      const payload = JSON.parse(el.getAttribute("data-detail"));
      window.p2pOpenPersonNetModal(payload);
    } catch(e){}
  };

  window.p2pOpenBankQuotaModal = async function(){
    let modal = document.getElementById("p2pBankQuotaModal");
    if(!modal){
      modal = document.createElement("div");
      modal.id = "p2pBankQuotaModal";
      modal.style.cssText = "position:fixed;inset:0;z-index:1000001;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;background:rgba(2,6,23,.72);backdrop-filter:blur(10px);";
      modal.addEventListener("mousedown", (e) => { if(e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    // Pedido explícito del usuario (ago 2026): tardaba 20-25s en mostrar las
    // órdenes al abrir -- la consulta en vivo a Binance de TODO el día tarda
    // eso en horas de mucho volumen. El poller de afuera (cada 20s, ver
    // p2pEnsureBankQuotaPolling) ya viene guardando el último resultado en
    // caché -- si existe, se muestra DE INMEDIATO acá y el fetch fresco
    // corre atrás, sin bloquear la apertura. Sin caché (primera vez), se
    // muestra "Cargando..." como antes.
    const cached = window.__p2pBankQuotaCache;
    modal.innerHTML = `
      <div style="width:min(480px,100%);border:1px solid rgba(52,211,153,.28);background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));border-radius:20px;padding:22px;position:relative;">
        <button type="button" onclick="document.getElementById('p2pBankQuotaModal').remove()" title="Cerrar" aria-label="Cerrar" style="position:absolute;top:16px;right:16px;width:28px;height:28px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(148,163,184,.1);color:#cbd5e1;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
        <h3 style="color:#00d4ff;margin-bottom:4px;padding-right:30px;">🏦 Banco Estado</h3>
        <p style="color:#8aa0ba;font-size:12px;margin-bottom:14px;">Cupo de HOY -- se reinicia solo a las 12 AM del día siguiente.</p>
        <div id="p2pBankQuotaBody" style="color:#94a3b8;font-size:13px;">${cached ? p2pRenderBankQuotaBody(cached) : "Cargando..."}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <button type="button" onclick="document.getElementById('p2pBankQuotaModal').remove()" style="padding:9px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
      </div>
    `;
    await window.p2pRefreshBankQuotaModal();
  };

  async function p2pFetchBankQuotaData(){
    const label = window.botActiveLabel || "ONZE";
    const exchange = window.botSelectedExchange || "binance";
    const res = await fetch(`/api/p2p/bank-quota?label=${encodeURIComponent(label)}&exchange=${encodeURIComponent(exchange)}&bank=estado`, { credentials: "include" });
    return res.json();
  }

  // Arma el HTML del cuerpo del modal a partir de {total, limit, orders} --
  // extraído para poder pintar de inmediato con la caché al abrir el modal,
  // y también con la respuesta fresca cuando llega (misma función, mismo
  // resultado visual, sin duplicar el armado del HTML en dos lugares).
  function p2pRenderBankQuotaBody(data){
    const total = Number(data.total || 0);
    const limit = Number(data.limit || 0);
    const pct = limit > 0 ? Math.min(100, (total / limit) * 100) : 0;
    const barColor = pct >= 100 ? "#fb7185" : pct >= 80 ? "#fbbf24" : "#34d399";
    const orders = data.orders || [];

    const rowsHtml = orders.length
      ? orders.map(o => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(148,163,184,.08);${o.excluded ? "opacity:.45;" : ""}">
            <div style="min-width:0;">
              <div style="color:#e2e8f0;font-size:12px;font-weight:700;${o.excluded ? "text-decoration:line-through;" : ""}">${p2pCapMoney(o.amountClp, 0)} CLP</div>
              <div style="color:#64748b;font-size:10px;">${o.time ? new Date(o.time).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }) : "—"}${o.buyerName ? " · " + p2pBankQuotaEsc(o.buyerName) : ""}</div>
            </div>
            <button type="button" onclick="window.p2pToggleBankQuotaExclusion('${o.orderNumber}')" title="${o.excluded ? "Volver a contar esta orden" : "Sacar del cupo (transfirió a otro banco)"}" style="flex:0 0 auto;padding:5px 10px;font-size:11px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:${o.excluded ? "rgba(52,211,153,.12)" : "rgba(251,113,133,.12)"};color:${o.excluded ? "#34d399" : "#fb7185"};cursor:pointer;">
              ${o.excluded ? "↩ Restaurar" : "🗑 Quitar"}
            </button>
          </div>
        `).join("")
      : `<p style="color:#64748b;font-size:12px;text-align:center;padding:12px 0;">Todavía no entró ninguna orden por Banco Estado hoy.</p>`;

    return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
        <strong style="color:#f8fafc;font-size:18px;">${p2pCapMoney(total, 0)} CLP</strong>
        <span style="color:#64748b;font-size:12px;">de ${p2pCapMoney(limit, 0)} CLP</span>
      </div>
      <div style="width:100%;height:10px;border-radius:6px;background:rgba(148,163,184,.15);overflow:hidden;margin-bottom:16px;">
        <div style="height:100%;width:${pct}%;background:${barColor};transition:width .3s;"></div>
      </div>
      <div style="font-weight:700;color:#cbd5e1;font-size:11px;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;">Órdenes de hoy</div>
      ${rowsHtml}
    `;
  }

  // Badge + barra afuera del botón (siempre visible, no solo al abrir el
  // modal) -- pedido explícito del usuario: "0/5.000.000" con barra, sumando
  // en vivo. Los elementos se buscan de NUEVO justo antes de escribir (no se
  // guardan al principio) porque renderP2PCapacityPanel puede reemplazar
  // todo el DOM mientras esta consulta (en vivo contra Binance, 2.5-5s) está
  // en vuelo -- si escribiéramos sobre una referencia vieja ya desconectada,
  // el cambio nunca se vería en pantalla.
  // Bug real confirmado en vivo (sep 2026): renderP2PCapacityPanel() llama a
  // p2pEnsureBankQuotaPolling() en CADA render (ver más abajo), y esa
  // función siempre dispara un fetch INMEDIATO sin ningún freno -- el
  // intervalo de 180s de más abajo solo evita agregar un segundo
  // setInterval, no evita esta llamada directa. En una cuenta con muchos
  // syncs disparando renders seguidos al cargar la página, esto se vio
  // pidiendo la misma consulta (que además puede escanear varias páginas en
  // vivo contra Binance) 8 veces en los primeros segundos. Este freno de 15s
  // aplica a CUALQUIER llamador (el render o el propio intervalo), sin
  // tocar la frecuencia real de actualización que ya se decidió (180s).
  let __p2pBankQuotaLastFetchAt = 0;
  window.p2pRefreshBankQuotaBadge = async function(){
    if(!document.getElementById("p2pBankQuotaBadge")) return;
    if(Date.now() - __p2pBankQuotaLastFetchAt < 15000) return;
    __p2pBankQuotaLastFetchAt = Date.now();
    try{
      const data = await p2pFetchBankQuotaData();
      const badge = document.getElementById("p2pBankQuotaBadge");
      const bar = document.getElementById("p2pBankQuotaBadgeBar");
      if(!data.ok){
        if(badge) badge.textContent = "···";
        return;
      }
      const total = Number(data.total || 0);
      const limit = Number(data.limit || 0);
      window.__p2pBankQuotaCache = { total, limit, orders: data.orders || [] };
      const pct = limit > 0 ? Math.min(100, (total / limit) * 100) : 0;
      const color = pct >= 100 ? "#fb7185" : pct >= 80 ? "#fbbf24" : "#34d399";
      if(badge){
        badge.textContent = `${p2pCapMoney(total, 0)}/${p2pCapMoney(limit, 0)}`;
        badge.style.color = color;
      }
      if(bar){
        bar.style.width = pct + "%";
        bar.style.background = color;
      }
    }catch(e){
      const badge = document.getElementById("p2pBankQuotaBadge");
      if(badge) badge.textContent = "···";
    }
  };

  // Arranca el refresco periódico del badge UNA sola vez (idempotente) --
  // separado del ciclo de renders de renderP2PCapacityPanel a propósito (ver
  // comentario arriba, en el bug de la carrera).
  //
  // Bug real confirmado en vivo (sep 2026, factura de Vercel disparada):
  // /api/p2p/bank-quota escanea el DÍA COMPLETO de órdenes contra Binance en
  // vivo (hasta 5 páginas SEGUIDAS, no en paralelo -- ver el comentario en
  // esa ruta sobre por qué no se puede paralelizar) cada vez que se llama.
  // A 20s de intervalo, con volumen alto esa consulta puede tardar 20-25s
  // ella sola -- casi sin respiro entre una llamada y la siguiente, sumando
  // CPU y memoria de Vercel activas casi sin parar mientras el panel esté
  // abierto. Es un cupo DIARIO de banco (límite de $5.000.000 CLP/día), no
  // un precio que cambie segundo a segundo -- no necesita esta frecuencia.
  // 3 minutos (180s) sigue siendo varias actualizaciones por hora, de sobra
  // para no pasarse del límite sin darse cuenta.
  window.p2pEnsureBankQuotaPolling = function(){
    window.p2pRefreshBankQuotaBadge();
    if(window.__p2pBankQuotaInterval) return;
    window.__p2pBankQuotaInterval = setInterval(window.p2pRefreshBankQuotaBadge, 180000);
  };

  window.p2pRefreshBankQuotaModal = async function(){
    if(!document.getElementById("p2pBankQuotaBody")) return;
    try{
      const data = await p2pFetchBankQuotaData();
      const body = document.getElementById("p2pBankQuotaBody");
      if(!body) return; // el modal se cerró mientras esperaba la respuesta
      if(!data.ok){
        body.innerHTML = `<p style="color:#fca5a5;">${p2pBankQuotaEsc(data.error || "Error cargando el cupo")}</p>`;
        return;
      }
      window.__p2pBankQuotaCache = { total: Number(data.total || 0), limit: Number(data.limit || 0), orders: data.orders || [] };
      body.innerHTML = p2pRenderBankQuotaBody(data);
    }catch(e){
      const body = document.getElementById("p2pBankQuotaBody");
      if(body) body.innerHTML = `<p style="color:#fca5a5;">Error cargando el cupo</p>`;
    }
  };

  window.p2pToggleBankQuotaExclusion = async function(orderNumber){
    const exchange = window.botSelectedExchange || "binance";
    try{
      await fetch("/api/p2p/bank-quota", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, exchange }),
      });
      await Promise.all([window.p2pRefreshBankQuotaModal(), window.p2pRefreshBankQuotaBadge()]);
    }catch(e){}
  };

  function ensureP2PInitialCapitalModal(){
    let modal = document.getElementById("p2pInitialCapitalModal");

    if(modal) return modal;

    modal = document.createElement("div");
    modal.id = "p2pInitialCapitalModal";
    modal.style.cssText = `
      position:fixed;
      inset:0;
      z-index:1000001;
      display:none;
      align-items:center;
      justify-content:center;
      padding:20px;
      background:rgba(2,6,23,.72);
      backdrop-filter:blur(10px);
    `;

    modal.innerHTML = `
      <div style="
        width:min(460px,100%);
        border:1px solid rgba(52,211,153,.28);
        background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));
        border-radius:24px;
        padding:24px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        color:#f8fafc;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px;">
          <div>
            <div style="font-size:22px;font-weight:900;letter-spacing:.2px;">Capital P2P</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:5px;">Registra, aumenta o retira capital base en USDT.</div>
          </div>
          <button type="button" onclick="closeP2PInitialCapitalModal()" style="
            width:34px;
            height:34px;
            border-radius:999px;
            border:1px solid rgba(148,163,184,.25);
            background:rgba(15,23,42,.8);
            color:#cbd5e1;
            cursor:pointer;
            font-size:18px;
          ">×</button>
        </div>

        <div style="
          border:1px solid rgba(96,165,250,.20);
          background:rgba(15,23,42,.62);
          border-radius:18px;
          padding:14px 16px;
          margin-bottom:14px;
        ">
          <div style="font-size:12px;color:#94a3b8;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Capital P2P actual (real)</div>
          <div id="p2pCurrentCapitalLabel" style="margin-top:6px;font-size:28px;font-weight:1000;color:#34d399;">0,00 USDT</div>
          <div id="p2pCapitalBreakdown" style="margin-top:6px;font-size:12px;color:#93c5fd;font-weight:700;"></div>
        </div>

        <div style="
          border:1px solid rgba(148,163,184,.15);
          background:rgba(15,23,42,.45);
          border-radius:18px;
          padding:12px 14px;
          margin-bottom:14px;
        ">
          <div style="font-size:12px;color:#94a3b8;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Historial por mes</div>
          <div id="p2pMonthlyHistoryList" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:12px;color:#64748b;">Sin datos todavía</div>
          </div>
        </div>

        <label style="display:block;font-size:13px;font-weight:800;color:#cbd5e1;margin-bottom:8px;">
          Acción
        </label>

        <select id="p2pInitialCapitalAction" style="
          width:100%;
          box-sizing:border-box;
          border-radius:16px;
          border:1px solid rgba(96,165,250,.30);
          background:rgba(15,43,78,.78);
          color:#f8fafc;
          padding:14px 16px;
          font-size:15px;
          font-weight:900;
          outline:none;
          margin-bottom:14px;
        ">
          <option value="set">Modificar capital total</option>
          <option value="add">Agregar capital</option>
          <option value="remove">Retirar capital</option>
        </select>

        <label style="display:block;font-size:13px;font-weight:800;color:#cbd5e1;margin-bottom:4px;">
          Monto en USDT
        </label>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">
          Este es el capital inicial (base fija). El "Capital P2P actual" de arriba ya le suma ganancias y resta retiros automáticamente.
        </div>

        <input id="p2pInitialCapitalInput" inputmode="decimal" type="text" placeholder="Ej: 6000" style="
          width:100%;
          box-sizing:border-box;
          border-radius:16px;
          border:1px solid rgba(52,211,153,.35);
          background:rgba(2,6,23,.65);
          color:#f8fafc;
          padding:15px 16px;
          font-size:24px;
          font-weight:900;
          outline:none;
          box-shadow:0 0 0 3px rgba(52,211,153,.08);
        ">

        <div id="p2pInitialCapitalPreview" style="
          min-height:18px;
          margin-top:8px;
          font-size:12px;
          color:#93c5fd;
          font-weight:800;
        "></div>

        <div id="p2pInitialCapitalError" style="
          min-height:18px;
          margin-top:6px;
          font-size:12px;
          color:#fca5a5;
          font-weight:700;
        "></div>

        <div style="
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:12px;
          margin-top:20px;
        ">
          <button type="button" onclick="closeP2PInitialCapitalModal()" style="
            border:0;
            border-radius:16px;
            padding:13px 14px;
            background:rgba(30,41,59,.95);
            color:#e2e8f0;
            font-size:15px;
            font-weight:900;
            cursor:pointer;
          ">Cancelar</button>

          <button type="button" onclick="saveP2PInitialCapitalFromModal()" style="
            border:0;
            border-radius:16px;
            padding:13px 14px;
            background:#34d399;
            color:#022c22;
            font-size:15px;
            font-weight:1000;
            cursor:pointer;
          ">Guardar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", (event)=>{
      if(event.target === modal) closeP2PInitialCapitalModal();
    });

    return modal;
  }

  window.closeP2PInitialCapitalModal = function closeP2PInitialCapitalModal(){
    const modal = document.getElementById("p2pInitialCapitalModal");
    if(modal) modal.style.display = "none";
  };

  function updateP2PInitialCapitalPreview(){
    const input = document.getElementById("p2pInitialCapitalInput");
    const action = document.getElementById("p2pInitialCapitalAction")?.value || "set";
    const preview = document.getElementById("p2pInitialCapitalPreview");
    const current = getP2PInitialCapital();

    // Bug real confirmado en vivo (ago 2026): el campo se llena con
    // String(numeroJS) -- formato normal con punto decimal (ej. "13183.05")
    // -- pero esto asumía formato chileno (punto=miles, coma=decimales) y le
    // borraba el punto, multiplicando por 100 cualquier monto con
    // decimales. Solo se convierte la coma (por si alguien escribe a la
    // chilena a mano), el punto se deja intacto.
    const raw = String(input?.value || "").trim();
    const clean = raw.replace(",", ".");
    const amount = Number(clean);

    if(!preview) return;

    if(!raw || !isFinite(amount)){
      preview.textContent = "";
      return;
    }

    let next = amount;
    if(action === "add") next = current + amount;
    if(action === "remove") next = current - amount;

    preview.textContent = `Capital resultante: ${p2pCapMoney(Math.max(next, 0), 2)} USDT`;
  }

  window.saveP2PInitialCapitalFromModal = function saveP2PInitialCapitalFromModal(){
    const input = document.getElementById("p2pInitialCapitalInput");
    const action = document.getElementById("p2pInitialCapitalAction")?.value || "set";
    const error = document.getElementById("p2pInitialCapitalError");

    // Bug real confirmado en vivo (ago 2026): el campo se llena con
    // String(numeroJS) -- formato normal con punto decimal (ej. "13183.05")
    // -- pero esto asumía formato chileno (punto=miles, coma=decimales) y le
    // borraba el punto, multiplicando por 100 cualquier monto con
    // decimales. Solo se convierte la coma (por si alguien escribe a la
    // chilena a mano), el punto se deja intacto.
    const raw = String(input?.value || "").trim();
    const clean = raw.replace(",", ".");
    const amount = Number(clean);
    const current = getP2PInitialCapital();

    if(error) error.textContent = "";

    if(!isFinite(amount) || amount < 0){
      if(error) error.textContent = "Ingresa un monto válido en USDT.";
      return;
    }

    let next = amount;

    if(action === "add"){
      next = current + amount;
    }

    if(action === "remove"){
      if(amount > current){
        if(error) error.textContent = "No puedes retirar más capital del que tienes registrado.";
        return;
      }
      next = current - amount;
    }

    saveP2PInitialCapital(next);
    syncP2PInitialCapitalToServer(next);
    updateP2PCapitalCard();
    if(typeof updateP2PDashboardWithCapacity === "function") updateP2PDashboardWithCapacity();
    closeP2PInitialCapitalModal();

    const label = action === "add" ? "agregado" : action === "remove" ? "retirado" : "actualizado";

    if(typeof showToast === "function"){
      showToast(`Capital P2P ${label}`);
    }
  };

  window.setP2PInitialCapital = function setP2PInitialCapital(){
    const modal = ensureP2PInitialCapitalModal();
    const input = modal.querySelector("#p2pInitialCapitalInput");
    const action = modal.querySelector("#p2pInitialCapitalAction");
    const error = modal.querySelector("#p2pInitialCapitalError");
    const preview = modal.querySelector("#p2pInitialCapitalPreview");
    const label = modal.querySelector("#p2pCurrentCapitalLabel");
    const breakdown = modal.querySelector("#p2pCapitalBreakdown");
    const current = getP2PInitialCapital();

    if(error) error.textContent = "";
    if(preview) preview.textContent = "";

    // Pedido explícito del usuario (ago 2026): esta pantalla mostraba solo
    // el capital inicial (base fija) bajo el título "Capital registrado
    // actual", lo que confundía porque no era el Capital P2P real (el
    // mismo que ya se ve en el dashboard = inicial + acumulado + ganancia
    // del mes - retirado). Ahora se muestra ese total real aquí también,
    // con el desglose abajo para que quede claro de dónde sale.
    const safeStats = typeof calculateP2PCapacityStats === "function" ? (calculateP2PCapacityStats() || {}) : {};
    const monthlyProfit = Number(getP2PRangeStatsFromCapacity(safeStats, "month").profitUsdt || 0);
    const accumulatedProfit = Number(window.__p2pAccumulatedProfitUsdt || 0);
    const totalWithdrawn = Number(window.__p2pTotalWithdrawnUsdt || 0);
    const realTotal = current + accumulatedProfit + monthlyProfit - totalWithdrawn;

    if(label) label.textContent = `${p2pCapMoney(realTotal, 2)} USDT`;
    if(breakdown){
      const sign = monthlyProfit >= 0 ? "+" : "-";
      let parts = [`Inicial: ${p2pCapMoney(current, 2)}`];
      if(accumulatedProfit !== 0) parts.push(`Acumulado: ${p2pCapMoney(accumulatedProfit, 2)}`);
      parts.push(`Este mes: ${sign}${p2pCapMoney(Math.abs(monthlyProfit), 2)}`);
      if(totalWithdrawn > 0) parts.push(`Retirado: -${p2pCapMoney(totalWithdrawn, 2)}`);
      breakdown.textContent = parts.join(" · ") + " USDT";
    }

    renderP2PMonthlyHistory("p2pMonthlyHistoryList", getP2PMonthlyBreakdown(safeStats));

    if(action){
      action.value = "set";
      action.onchange = updateP2PInitialCapitalPreview;
    }

    if(input){
      input.value = current ? String(current) : "";
      input.oninput = updateP2PInitialCapitalPreview;
      setTimeout(()=>{
        input.focus();
        input.select();
        updateP2PInitialCapitalPreview();
      }, 50);
    }

    modal.style.zIndex = "1000001";
    modal.style.display = "flex";
  };

  function p2pChileDayKey(raw){
    const d = raw ? new Date(raw) : new Date();
    if(Number.isNaN(d.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);

    const y = parts.find(p => p.type === "year")?.value || "";
    const m = parts.find(p => p.type === "month")?.value || "";
    const day = parts.find(p => p.type === "day")?.value || "";

    return y && m && day ? `${y}-${m}-${day}` : "";
  }
  // window.-scoped a propósito -- este archivo tiene varios <script> con su
  // propio scope IIFE, y el modal de completados del socio (socioBn*, en
  // OTRO bloque <script>) también necesita esta misma conversión de fecha.
  window.p2pChileDayKey = p2pChileDayKey;

  function p2pChileMonthKey(raw){
    const key = p2pChileDayKey(raw);
    return key ? key.slice(0, 7) : "";
  }

  function p2pChileDateFromKey(key){
    if(!key) return null;
    const [y, m, d] = key.split("-").map(Number);
    if(!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }

  function isP2PInCurrentWeek(raw){
    const itemKey = p2pChileDayKey(raw);
    const todayKey = p2pChileDayKey(new Date());
    const itemDate = p2pChileDateFromKey(itemKey);
    const todayDate = p2pChileDateFromKey(todayKey);

    if(!itemDate || !todayDate) return false;

    const day = todayDate.getUTCDay();
    const diffToMonday = day === 0 ? 6 : day - 1;

    const start = new Date(todayDate);
    start.setUTCDate(todayDate.getUTCDate() - diffToMonday);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);

    return itemDate >= start && itemDate <= end;
  }

  function isP2PAfterCapacityBaseline(raw){
    const baselineTs = typeof getP2PCapacityBaselineTs === "function" ? getP2PCapacityBaselineTs() : 0;
    if(!baselineTs) return true;

    const ts = Number(getOrderTs(raw) || 0) || new Date(raw || 0).getTime();
    if(!ts || !Number.isFinite(ts)) return false;

    return ts >= baselineTs;
  }

  function isP2PInRange(raw, range){
    // Regla global: el módulo P2P empieza en 0 desde el último reinicio.
    // Ningún rango debe tomar ventas/capacity anteriores a esa fecha/hora.
    if(!isP2PAfterCapacityBaseline(raw)) return false;

    if(range === "total") return true;
    if(range === "today") return p2pChileDayKey(raw) === p2pChileDayKey(new Date());
    if(range === "week") return isP2PInCurrentWeek(raw);
    if(range === "month") return p2pChileMonthKey(raw) === p2pChileMonthKey(new Date());
    // "Ayer" y "Últimos 7 días" -- pedido explícito del usuario (ago 2026),
    // mismos botones rápidos que ya existían en el panel de Estadísticas del
    // socio (AKI Transfers), ahora también acá.
    if(range === "yesterday"){
      const day = p2pChileDayKey(raw);
      if(!day) return false;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return day === p2pChileDayKey(yesterday);
    }
    if(range === "7d"){
      const day = p2pChileDayKey(raw);
      if(!day) return false;
      const from = new Date();
      from.setDate(from.getDate() - 6);
      const fromKey = p2pChileDayKey(from);
      const todayKey = p2pChileDayKey(new Date());
      return day >= fromKey && day <= todayKey;
    }
    if(range === "custom"){
      const day = p2pChileDayKey(raw);
      if(!day) return false;
      const from = window.__p2pCustomFrom || "0000-01-01";
      const to = window.__p2pCustomTo || "9999-12-31";
      return day >= from && day <= to;
    }
    return p2pChileDayKey(raw) === p2pChileDayKey(new Date());
  }

  function p2pRangeLabel(range){
    if(range === "today") return "Hoy";
    if(range === "yesterday") return "Ayer";
    if(range === "7d") return "Últimos 7 días";
    if(range === "week") return "Semana";
    if(range === "month") return "Este mes";
    if(range === "total") return "Total";
    if(range === "custom") return "Personalizado";
    return "Hoy";
  }

  // Aplica el filtro "Desde/Hasta" del modal de Métricas P2P — guarda el rango
  // elegido y vuelve a pintar el contenido con range="custom" (mismo patrón
  // que los botones fijos Hoy/Semana/Mes/Total, ver isP2PInRange).
  window.applyP2PCustomRange = function applyP2PCustomRange(){
    const fromEl = document.getElementById("p2pCustomFrom");
    const toEl = document.getElementById("p2pCustomTo");
    const from = fromEl?.value || "";
    const to = toEl?.value || "";
    if(!from || !to){
      if(typeof showToast === "function") showToast("Elige ambas fechas", "error");
      return;
    }
    if(from > to){
      if(typeof showToast === "function") showToast("\"Desde\" no puede ser después de \"Hasta\"", "error");
      return;
    }
    window.__p2pCustomFrom = from;
    window.__p2pCustomTo = to;
    renderP2PRangeDetailContent("custom");
  };

  function getP2PRangeStatsFromCapacity(stats, range, exchange){
    const result = {
      range,
      soldUsdt: 0,
      clpReceived: 0,
      commissionUsdt: 0,
      commissionClp: 0,
      costClp: 0,
      profitClp: 0,
      profitUsdt: 0,
      profitPct: 0,
      avgSellPrice: 0,
      ordersCount: 0,
      providers: {},
      parts: []
    };

    const seenOrders = new Set();
    let bucketOrdersCount = 0;

    (stats.capacities || []).forEach(cap => {
      const buyPrice = Number(cap.buyPrice || 0);
      const provider = cap.provider || "Proveedor";

      // Capacitys "aligerados" (ver /api/p2p/capacity, AGENTS.md): ya no
      // traen saleParts, sino un resumen por día (dailyBuckets). Alcanza
      // para sumar los totales de cualquier rango (Hoy/Este mes/Total/
      // Personalizado, todos agrupan por día) -- lo único que se pierde es
      // el detalle línea-por-línea en result.parts, que no aplica a un
      // capacity de hace más de un mes (nunca hace falta, confirmado con
      // el usuario).
      if(Array.isArray(cap.dailyBuckets) && cap.dailyBuckets.length){
        cap.dailyBuckets.forEach(bucket => {
          if(!bucket.day) return;
          if(!isP2PInRange(bucket.day, range)) return;
          if(exchange && exchange !== "all" && (bucket.exchange || "binance") !== exchange) return;

          result.soldUsdt += Number(bucket.soldUsdt || 0);
          result.clpReceived += Number(bucket.clpReceived || 0);
          result.commissionUsdt += Number(bucket.commissionUsdt || 0);
          result.commissionClp += Number(bucket.commissionClp || 0);
          result.costClp += Number(bucket.costClp || 0);
          result.profitClp += Number(bucket.profitClp || 0);
          bucketOrdersCount += Number(bucket.ordersCount || 0);

          if(!result.providers[provider]){
            result.providers[provider] = { provider, soldUsdt: 0, clpReceived: 0, commissionUsdt: 0, commissionClp: 0, profitClp: 0, costClp: 0 };
          }
          result.providers[provider].soldUsdt += Number(bucket.soldUsdt || 0);
          result.providers[provider].clpReceived += Number(bucket.clpReceived || 0);
          result.providers[provider].commissionUsdt += Number(bucket.commissionUsdt || 0);
          result.providers[provider].commissionClp += Number(bucket.commissionClp || 0);
          result.providers[provider].profitClp += Number(bucket.profitClp || 0);
          result.providers[provider].costClp += Number(bucket.costClp || 0);
        });
        return;
      }

      (cap.saleParts || []).forEach(part => {
        if(!part.createdAt) return;
        if(!isP2PInRange(part.createdAt, range)) return;
        // exchange: "all"/undefined = sin filtro (Binance+Bybit juntos,
        // usado para "Capital P2P" que es una sola bolsa compartida).
        if(exchange && exchange !== "all" && (part.exchange || "binance") !== exchange) return;

        const assignedUsdt = Number(part.assignedUsdt || 0);
        const assignedClp = Number(part.assignedClp || 0);
        const unitPrice = Number(part.unitPrice || 0);
        const commissionUsdt = Number(part.commissionUsdt || 0);
        const commissionClp = commissionUsdt * (unitPrice || 0);
        const partBuyPrice = Number(part.buyPrice || buyPrice);
        const costClp = assignedUsdt * partBuyPrice;
        const profitClp = assignedClp - costClp - commissionClp;

        result.soldUsdt += assignedUsdt;
        result.clpReceived += assignedClp;
        result.commissionUsdt += commissionUsdt;
        result.commissionClp += commissionClp;
        result.costClp += costClp;
        result.profitClp += profitClp;

        const orderNumber = String(part.orderNumber || "");
        if(orderNumber) seenOrders.add(orderNumber);

        if(!result.providers[provider]){
          result.providers[provider] = {
            provider,
            soldUsdt: 0,
            clpReceived: 0,
            commissionUsdt: 0,
            commissionClp: 0,
            profitClp: 0,
            costClp: 0
          };
        }

        result.providers[provider].soldUsdt += assignedUsdt;
        result.providers[provider].clpReceived += assignedClp;
        result.providers[provider].commissionUsdt += commissionUsdt;
        result.providers[provider].commissionClp += commissionClp;
        result.providers[provider].profitClp += profitClp;
        result.providers[provider].costClp += costClp;

        result.parts.push({
          provider,
          orderNumber,
          assignedUsdt,
          assignedClp,
          unitPrice,
          commissionUsdt,
          commissionClp,
          buyPrice: partBuyPrice,
          costClp,
          profitClp,
          createdAt: part.createdAt
        });
      });
    });

    result.ordersCount = seenOrders.size + bucketOrdersCount;
    result.avgSellPrice = result.soldUsdt > 0 ? result.clpReceived / result.soldUsdt : 0;
    result.profitUsdt = result.avgSellPrice > 0 ? result.profitClp / result.avgSellPrice : 0;
    result.profitPct = result.costClp > 0 ? (result.profitClp / result.costClp) * 100 : 0;

    result.parts.sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return result;
  }

  // Pedido explícito del usuario (jul 2026): al hacer click en "Capital P2P"
  // quiere ver el desglose de ganancia MES A MES (no solo el total
  // acumulado) -- agrupa cada venta por su mes calendario (hora Chile) en
  // vez de un rango fijo, para armar el historial completo.
  function getP2PMonthlyBreakdown(stats, exchange){
    const months = {};
    (stats.capacities || []).forEach(cap => {
      const buyPrice = Number(cap.buyPrice || 0);

      // Capacitys "aligerados" -- ver getP2PRangeStatsFromCapacity más
      // arriba, mismo mecanismo: el resumen por día alcanza para agrupar
      // por mes también (un día siempre cae en un solo mes).
      if(Array.isArray(cap.dailyBuckets) && cap.dailyBuckets.length){
        cap.dailyBuckets.forEach(bucket => {
          if(!bucket.day) return;
          if(!isP2PAfterCapacityBaseline(bucket.day)) return;
          if(exchange && exchange !== "all" && (bucket.exchange || "binance") !== exchange) return;
          const key = bucket.day.slice(0, 7);
          if(!key) return;
          if(!months[key]) months[key] = { key, soldUsdt: 0, clpReceived: 0, commissionClp: 0, costClp: 0, profitClp: 0 };
          months[key].soldUsdt += Number(bucket.soldUsdt || 0);
          months[key].clpReceived += Number(bucket.clpReceived || 0);
          months[key].commissionClp += Number(bucket.commissionClp || 0);
          months[key].costClp += Number(bucket.costClp || 0);
          months[key].profitClp += Number(bucket.profitClp || 0);
        });
        return;
      }

      (cap.saleParts || []).forEach(part => {
        if(!part.createdAt) return;
        if(!isP2PAfterCapacityBaseline(part.createdAt)) return;
        if(exchange && exchange !== "all" && (part.exchange || "binance") !== exchange) return;

        const key = p2pChileMonthKey(part.createdAt);
        if(!key) return;
        if(!months[key]) months[key] = { key, soldUsdt: 0, clpReceived: 0, commissionClp: 0, costClp: 0, profitClp: 0 };

        const assignedUsdt = Number(part.assignedUsdt || 0);
        const assignedClp = Number(part.assignedClp || 0);
        const unitPrice = Number(part.unitPrice || 0);
        const commissionUsdt = Number(part.commissionUsdt || 0);
        const commissionClp = commissionUsdt * (unitPrice || 0);
        const partBuyPrice = Number(part.buyPrice || buyPrice);
        const costClp = assignedUsdt * partBuyPrice;
        const profitClp = assignedClp - costClp - commissionClp;

        months[key].soldUsdt += assignedUsdt;
        months[key].clpReceived += assignedClp;
        months[key].commissionClp += commissionClp;
        months[key].costClp += costClp;
        months[key].profitClp += profitClp;
      });
    });

    return Object.values(months).map(m => {
      const avgSell = m.soldUsdt > 0 ? m.clpReceived / m.soldUsdt : 0;
      const profitUsdt = avgSell > 0 ? m.profitClp / avgSell : 0;
      return Object.assign({}, m, { avgSell, profitUsdt });
    }).sort((a, b) => b.key.localeCompare(a.key));
  }

  function p2pMonthLabel(key){
    const parts = String(key || "").split("-");
    const y = Number(parts[0]), m = Number(parts[1]);
    if(!y || !m) return key || "";
    const names = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return `${names[m - 1] || key} ${y}`;
  }

  function renderP2PMonthlyHistory(containerId, months){
    const el = document.getElementById(containerId);
    if(!el) return;
    if(!months || !months.length){
      el.innerHTML = `<div style="font-size:12px;color:#64748b;">Sin datos todavía</div>`;
      return;
    }
    el.innerHTML = months.map(m => {
      const sign = m.profitUsdt >= 0 ? "+" : "-";
      const color = m.profitUsdt >= 0 ? "#34d399" : "#fb7185";
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(148,163,184,.08);font-size:13px;">
        <span style="color:#cbd5e1;font-weight:700;">${p2pMonthLabel(m.key)}</span>
        <span style="color:${color};font-weight:900;">${sign}${p2pCapMoney(Math.abs(m.profitUsdt), 2)} USDT</span>
      </div>`;
    }).join("");
  }

  function ensureP2PDetailButton(){
    const btn = document.getElementById("btn-p2p-detail-main");
    if(btn){
      btn.onclick = function(){
        openP2PRangeDetailModal("today");
      };
    }
  }

  function p2pDetailFilterButton(range, activeRange){
    const active = range === activeRange;
    return `
      <button type="button" onclick="renderP2PRangeDetailContent('${range}')" style="
        border:1px solid ${active ? "rgba(52,211,153,.65)" : "rgba(148,163,184,.22)"};
        background:${active ? "rgba(52,211,153,.16)" : "rgba(15,23,42,.82)"};
        color:${active ? "#34d399" : "#cbd5e1"};
        border-radius:999px;
        padding:9px 14px;
        font-size:13px;
        font-weight:950;
        cursor:pointer;
      ">${p2pRangeLabel(range)}</button>
    `;
  }

  // Mismo patrón visual que socioBnDashCard (AKI Transfers) -- pedido
  // explícito del usuario (ago 2026): unificar el look de "Métricas P2P"
  // (propio y de Hector) con el de Estadísticas del socio. No se reusa
  // socioBnDashCard directo porque vive en OTRO bloque <script> (ver el
  // comentario de p2pBankQuotaEsc más arriba sobre este mismo problema).
  function p2pDashCard(label, value, opts){
    opts = opts || {};
    const cls = "p2p-dashboard-card" + (opts.main ? " main" : "");
    const clickAttrs = opts.onClick ? ` style="cursor:pointer;" onclick="${opts.onClick}" title="${opts.title || ''}"` : "";
    return `<div class="${cls}"${clickAttrs}>
      <div class="p2p-dashboard-label">${label}</div>
      <div class="p2p-dashboard-value" style="color:${opts.color || '#f8fafc'};">${value}</div>
      ${opts.sub ? `<div class="p2p-dashboard-small" style="${opts.subColor ? 'color:' + opts.subColor + ';' : ''}">${opts.sub}</div>` : ''}
    </div>`;
  }

  // "Ganancia por día" del rango elegido -- mismo desglose que ya existía
  // para el socio (ahí viene del servidor, acá se arma en el cliente con
  // los mismos saleParts que ya usa getP2PRangeStatsFromCapacity, agrupados
  // por día en vez de sumados todos juntos).
  function getP2PDailyBreakdownFromCapacity(stats, range, exchange){
    const byDay = new Map();
    (stats.capacities || []).forEach(cap => {
      const buyPrice = Number(cap.buyPrice || 0);

      // Capacitys "aligerados" -- mismo mecanismo que getP2PRangeStatsFromCapacity.
      if(Array.isArray(cap.dailyBuckets) && cap.dailyBuckets.length){
        cap.dailyBuckets.forEach(bucket => {
          if(!bucket.day) return;
          if(!isP2PInRange(bucket.day, range)) return;
          if(exchange && exchange !== "all" && (bucket.exchange || "binance") !== exchange) return;
          let entry = byDay.get(bucket.day);
          if(!entry){
            entry = { date: bucket.day, clpReceived: 0, profitClp: 0, costClp: 0, soldUsdt: 0 };
            byDay.set(bucket.day, entry);
          }
          entry.clpReceived += Number(bucket.clpReceived || 0);
          entry.profitClp += Number(bucket.profitClp || 0);
          entry.costClp += Number(bucket.costClp || 0);
          entry.soldUsdt += Number(bucket.soldUsdt || 0);
        });
        return;
      }

      (cap.saleParts || []).forEach(part => {
        if(!part.createdAt) return;
        if(!isP2PInRange(part.createdAt, range)) return;
        if(exchange && exchange !== "all" && (part.exchange || "binance") !== exchange) return;
        const day = p2pChileDayKey(part.createdAt);
        if(!day) return;

        const assignedUsdt = Number(part.assignedUsdt || 0);
        const assignedClp = Number(part.assignedClp || 0);
        const unitPrice = Number(part.unitPrice || 0);
        const commissionUsdt = Number(part.commissionUsdt || 0);
        const commissionClp = commissionUsdt * (unitPrice || 0);
        const partBuyPrice = Number(part.buyPrice || buyPrice);
        const costClp = assignedUsdt * partBuyPrice;
        const profitClp = assignedClp - costClp - commissionClp;

        let entry = byDay.get(day);
        if(!entry){
          entry = { date: day, clpReceived: 0, profitClp: 0, costClp: 0, soldUsdt: 0 };
          byDay.set(day, entry);
        }
        entry.clpReceived += assignedClp;
        entry.profitClp += profitClp;
        entry.costClp += costClp;
        entry.soldUsdt += assignedUsdt;
      });
    });
    return Array.from(byDay.values())
      .map(e => ({ ...e, avgBuyPrice: e.soldUsdt > 0 ? e.costClp / e.soldUsdt : 0 }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  window.renderP2PRangeDetailContent = function renderP2PRangeDetailContent(range){
    const content = document.getElementById("p2pRangeDetailContent");
    if(!content) return;

    const modalExchange = window.__p2pModalExchange || window.__p2pResumenExchange || "binance";
    // La vista "Total" combinada solo muestra el resumen de HOY -- no tiene
    // sentido comparar semana/mes/histórico mezclando los 3 exchanges acá,
    // cada uno se revisa por separado si hace falta más detalle.
    if(modalExchange === "all") range = "today";
    // Cacheado para poder re-renderizar con el mismo rango después de
    // registrar/borrar un retiro o gasto (ver p2pWithdrawRegister/Delete).
    window.__p2pLastRange = range;
    // El formulario de Retiros y gastos se reconstruye entero en cada
    // render (como el resto de este modal) -- vuelve siempre a "Retiro" por
    // defecto para no mostrar un toggle "Gasto" desincronizado del HTML
    // recién creado.
    window.__p2pWithdrawKind = 'retiro';
    const exLabel = p2pExchangeDisplayLabel(modalExchange);
    const stats = calculateP2PCapacityStats();
    const data = getP2PRangeStatsFromCapacity(stats, range, modalExchange);
    // Capital P2P es una sola bolsa compartida entre Binance y Bybit -- se
    // calcula SIEMPRE sin filtro de exchange, sin importar la pestaña activa.
    const dataAll = getP2PRangeStatsFromCapacity(stats, range);

    const initialCapital = typeof getP2PInitialCapital === "function" ? getP2PInitialCapital() : 0;
    // Pedido explícito del usuario (ago 2026): igual que en el capital del
    // socio, cada retiro/gasto registrado resta al instante del total.
    const totalWithdrawnUsdt = Number(window.__p2pTotalWithdrawnUsdt || 0);
    // "Capital P2P" NO usa el rango elegido arriba (Hoy/Semana/Mes/Total) --
    // siempre es inicial (fijo) + acumulada de meses terminados + ganancia
    // de ESTE MES calendario, igual que updateP2PCapitalCard() (definición
    // confirmada con el usuario, ago 2026 -- ver el comentario largo ahí
    // antes de volver a tocar esto).
    const capitalMonthProfit = Number(getP2PRangeStatsFromCapacity(stats, "month").profitUsdt || 0);
    const capitalAccumulatedProfit = Number(window.__p2pAccumulatedProfitUsdt || 0);
    const capitalByRange = initialCapital + capitalAccumulatedProfit + capitalMonthProfit - totalWithdrawnUsdt;

    // PPM (SII) del rango elegido -- sobre el CLP recibido TOTAL (todos los
    // exchanges juntos, como el Capital P2P), igual que la tarjeta del socio.
    const p2pPpmPct = window.__p2pPpmPct;
    const p2pHasPpmPct = p2pPpmPct !== null && p2pPpmPct !== undefined;
    const p2pPpmClp = p2pHasPpmPct ? Number(dataAll.clpReceived || 0) * (p2pPpmPct / 100) : null;
    const p2pPpmUsdt = (p2pHasPpmPct && dataAll.avgSellPrice > 0) ? p2pPpmClp / dataAll.avgSellPrice : null;

    const p2pTodayStr = p2pChileDayKey(new Date());
    const p2pPrevMonthDate = new Date(p2pTodayStr + "T12:00:00");
    p2pPrevMonthDate.setMonth(p2pPrevMonthDate.getMonth() - 1);
    const p2pPrevMonth = p2pPrevMonthDate.toISOString().slice(0, 7);

    const avgSellPrice = Number(data.avgSellPrice || 0);
    const avgBuyUsed = data.soldUsdt > 0 ? data.costClp / data.soldUsdt : 0;
    const sign = data.profitUsdt >= 0 ? "+" : "-";
    const dailyBreakdown = getP2PDailyBreakdownFromCapacity(stats, range, modalExchange);

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
        ${modalExchange === "all" ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="border:1px solid rgba(52,211,153,.65);background:rgba(52,211,153,.16);color:#34d399;border-radius:999px;padding:9px 14px;font-size:13px;font-weight:950;">Hoy · Total combinado</span>
        </div>
        ` : `
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${p2pDetailFilterButton("month", range)}
          ${p2pDetailFilterButton("today", range)}
          ${p2pDetailFilterButton("yesterday", range)}
          ${p2pDetailFilterButton("7d", range)}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <label style="font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:4px;">
            Desde
            <input type="date" id="p2pCustomFrom" value="${window.__p2pCustomFrom || ""}" style="
              background:rgba(15,23,42,.85);border:1px solid rgba(148,163,184,.22);border-radius:8px;
              color:#e2e8f0;font-size:12px;padding:5px 8px;
            ">
          </label>
          <label style="font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:4px;">
            Hasta
            <input type="date" id="p2pCustomTo" value="${window.__p2pCustomTo || ""}" style="
              background:rgba(15,23,42,.85);border:1px solid rgba(148,163,184,.22);border-radius:8px;
              color:#e2e8f0;font-size:12px;padding:5px 8px;
            ">
          </label>
          <button type="button" onclick="window.applyP2PCustomRange()" style="
            border:1px solid ${range === "custom" ? "rgba(52,211,153,.65)" : "rgba(148,163,184,.22)"};
            background:${range === "custom" ? "rgba(52,211,153,.16)" : "rgba(15,23,42,.82)"};
            color:${range === "custom" ? "#34d399" : "#cbd5e1"};
            border-radius:999px;padding:6px 14px;font-size:12px;font-weight:950;cursor:pointer;
          ">Ver</button>
        </div>
        `}
      </div>

      <div class="p2p-dashboard-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">
        ${(function(){
          // Mismas 9 tarjetas y mismo orden que "Estadísticas" del socio
          // (AKI Transfers) -- pedido explícito del usuario (ago 2026):
          // unificar el look de Métricas P2P (propio y de Hector) con esa
          // pantalla. La lógica de cada número es la que ya existía acá
          // (capitalByRange, PPM, Ganancia neta a repartir), solo cambia
          // cómo se presenta.
          const GREEN = "#34d399", RED = "#fb7185", WHITE = "#f8fafc";
          const profitColor = data.profitUsdt >= 0 ? GREEN : RED;
          const cards = [
            p2pDashCard(`CLP recibido ${exLabel}`, p2pCapMoney(data.clpReceived, 0) + " CLP", { main: true, color: GREEN }),
            p2pDashCard(`USDT vendido ${exLabel}`, p2pCapMoney(data.soldUsdt, 2) + " USDT", { color: GREEN }),
            p2pDashCard(
              "Ganancia (ya con comisión descontada)",
              sign + p2pCapMoney(Math.abs(data.profitUsdt), 2) + " USDT",
              { color: profitColor, sub: sign + p2pCapMoney(Math.abs(data.profitClp), 0) + " CLP", subColor: profitColor }
            ),
            p2pDashCard("Ganancia %", p2pCapMoney(data.profitPct, 2) + "%", { color: profitColor }),
            p2pDashCard(`Comisión ${exLabel}`, p2pCapMoney(data.commissionUsdt, 2) + " USDT", { color: WHITE }),
            p2pDashCard(
              "Tasas promedio",
              `<span style="font-size:13px;">Tasa promedio venta: <strong style="color:${GREEN};">${p2pCapMoney(avgSellPrice, 2)} CLP</strong></span>`,
              { color: WHITE, sub: `Tasa promedio compra: <strong style="color:#38bdf8;">${p2pCapMoney(avgBuyUsed, 2)} CLP</strong>` }
            ),
            p2pDashCard(
              "Capital P2P",
              p2pCapMoney(capitalByRange, 2) + " USDT",
              { color: GREEN, sub: `Inicial: ${p2pCapMoney(initialCapital, 2)} USDT · Este mes: ${sign}${p2pCapMoney(Math.abs(capitalMonthProfit), 2)} USDT${totalWithdrawnUsdt > 0 ? ` · Retirado: -${p2pCapMoney(totalWithdrawnUsdt, 2)} USDT` : ''}` }
            ),
            p2pDashCard(
              "PPM a pagar (SII)",
              p2pHasPpmPct ? p2pCapMoney(p2pPpmClp, 0) + " CLP" : "Configura el %",
              {
                color: "#fbbf24",
                sub: p2pHasPpmPct
                  ? `${p2pPpmUsdt !== null ? p2pCapMoney(p2pPpmUsdt, 2) + " USDT · " : ""}${p2pCapMoney(p2pPpmPct, 2)}% del CLP recibido — click para editar`
                  : "Click para definir el % (pendiente con tu contadora)",
                onClick: "window.p2pOpenPpmModal()", title: "Click para editar el % de PPM",
              }
            ),
          ];

          if(!window.HAS_ONZE_CORE_BUSINESS){
            // Pedido explícito del usuario (ago 2026): reparto 50/50 de la
            // ganancia del rango YA descontado el PPM -- el capital inicial
            // nunca se toca, esto es solo sobre la ganancia.
            const pct = p2pPpmPct;
            const hasPct = p2pHasPpmPct;
            const avgSell = dataAll.avgSellPrice ? Number(dataAll.avgSellPrice) : 0;
            const ganancia = dataAll.profitClp !== null && dataAll.profitClp !== undefined ? Number(dataAll.profitClp) : null;
            const ppmClp2 = (hasPct && ganancia !== null) ? Number(dataAll.clpReceived || 0) * (pct / 100) : null;
            const netoClp = (hasPct && ganancia !== null) ? ganancia - ppmClp2 : null;
            const netoUsdt = (netoClp !== null && avgSell > 0) ? netoClp / avgSell : null;
            const perPersonUsdt = (netoUsdt !== null) ? netoUsdt / 2 : null;
            const signN = netoClp !== null && netoClp >= 0 ? "+" : "";
            const colorN = netoClp === null ? WHITE : (netoClp >= 0 ? GREEN : RED);

            if(netoClp === null){
              cards.push(`<div class="p2p-dashboard-card">
                <div class="p2p-dashboard-label">Ganancia neta a repartir</div>
                <div class="p2p-dashboard-value" style="font-size:15px;color:${WHITE};">Configura el % de PPM en la tarjeta anterior</div>
              </div>`);
            } else {
              // Pedido explícito del usuario (ago 2026): si alguien ya
              // retiró parte de su mitad DURANTE el mes (sin que el período
              // haya cerrado), acá tiene que descontarse de SU propia
              // columna, no solo del Capital P2P general -- ej: 500/500 de
              // reparto, Hector retira 200, debe quedar Hector 300 / Josber
              // 500. Solo para el tenant de Hector (arrancó desde 0 en este
              // reset, así que cada retiro que se registre de acá en
              // adelante SÍ es del mes real que dice ser) -- en AKI
              // Transfers se revirtió porque los retiros viejos están
              // fechados el día que se registraron, no el mes que liquidan.
              const rawWithdrawals = Array.isArray(window.__p2pWithdrawalsRaw) ? window.__p2pWithdrawalsRaw : [];

              // Pedido explícito del usuario (ago 2026): NO expandir la
              // tarjeta al hacer click -- abrir una pantalla aparte (modal),
              // igual que "Capital P2P". La fila queda corta (nombre +
              // cantidad de retiros a la izquierda, total a recibir a la
              // derecha) y el detalle (ganancia total, cada retiro, total a
              // recibir) se arma en window.p2pOpenPersonNetModal (definido
              // más arriba, compartido con la cuenta AKI Transfers).
              const personRowP2P = (name) => {
                const withdrawalsOf = rawWithdrawals.filter(w => w.kind === "retiro" && String(w.person || "").trim().toLowerCase() === name.toLowerCase() && isP2PInRange(w.withdrawnAt, range));
                const withdrawnUsdt = withdrawalsOf.reduce((sum, w) => sum + Number(w.amountUsdt || 0), 0);
                const shareUsdt = perPersonUsdt !== null ? perPersonUsdt - withdrawnUsdt : null;
                const shareClp = (shareUsdt !== null && avgSell > 0) ? shareUsdt * avgSell : null;
                const sign = shareUsdt !== null && shareUsdt >= 0 ? "+" : "";
                const color = shareUsdt === null ? WHITE : (shareUsdt >= 0 ? GREEN : RED);
                const countLabel = withdrawalsOf.length === 1 ? "1 retiro" : `${withdrawalsOf.length} retiros`;
                const gananciaSign = perPersonUsdt !== null && perPersonUsdt >= 0 ? "+" : "";
                const payload = {
                  name, color, sign, gananciaSign,
                  ganancia: p2pCapMoney(perPersonUsdt, 2),
                  share: p2pCapMoney(shareUsdt, 2),
                  shareClp: p2pCapMoney(shareClp, 0),
                  withdrawals: withdrawalsOf.map(w => ({
                    date: new Date(w.withdrawnAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
                    note: w.note || "",
                    amount: p2pCapMoney(Number(w.amountUsdt), 2),
                  })),
                };
                const payloadAttr = JSON.stringify(payload).replace(/'/g, "&#39;");
                return `
                <div style="cursor:pointer;padding:9px 10px;margin-top:8px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.4);transition:border-color .15s ease;" onmouseover="this.style.borderColor='rgba(148,163,184,.32)'" onmouseout="this.style.borderColor='rgba(148,163,184,.14)'" onclick="window.p2pOpenPersonNetModalFromEl(this)" data-detail='${payloadAttr}'>
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <span style="color:#cbd5e1;font-weight:800;font-size:12.5px;">${name}${withdrawalsOf.length ? ` <span style="color:#64748b;font-weight:600;">(${countLabel})</span>` : ''}</span>
                    <span style="color:${color};font-weight:800;font-size:12.5px;white-space:nowrap;">${sign}${p2pCapMoney(shareUsdt, 2)} USDT ›</span>
                  </div>
                </div>`;
              };
              cards.push(`<div class="p2p-dashboard-card">
                <div class="p2p-dashboard-label">Ganancia neta a repartir</div>
                <div style="font-size:16px;font-weight:900;color:${colorN};">
                  ${signN}${p2pCapMoney(netoUsdt, 2)} USDT <span style="color:#8aa0ba;font-weight:700;">· ${signN}${p2pCapMoney(netoClp, 0)} CLP</span>
                </div>
                ${personRowP2P("Hector")}
                ${personRowP2P("Josber")}
              </div>`);
            }
          }

          return cards.join("");
        })()}
      </div>

      <details class="p2p-collapsible">
        <summary>Ganancia por día</summary>
        <div class="p2p-collapsible-body">
          ${dailyBreakdown.length
            ? dailyBreakdown.map(d => {
                const dSign = d.profitClp >= 0 ? "+" : "-";
                const dColor = d.profitClp >= 0 ? "#34d399" : "#fb7185";
                const dProfitUsdt = d.avgBuyPrice > 0 ? d.profitClp / d.avgBuyPrice : null;
                return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(148,163,184,.1);font-size:13px;">
                  <span style="color:#f8fafc;">${d.date}</span>
                  <span style="color:#8aa0ba;">${p2pCapMoney(d.clpReceived, 0)} CLP</span>
                  <span style="color:${dColor};text-align:right;">${dSign}${p2pCapMoney(Math.abs(d.profitClp), 0)} CLP${dProfitUsdt !== null ? `<br><span style="font-size:11px;">${dSign}${p2pCapMoney(Math.abs(dProfitUsdt), 2)} USDT</span>` : ""}</span>
                </div>`;
              }).join("")
            : `<div class="p2p-dashboard-empty">Sin ventas en este rango.</div>`}
        </div>
      </details>

      <h3 class="section-title" style="margin:18px 0 8px;">💸 Retiros y gastos</h3>
      <div class="p2p-withdraw-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="p2p-withdraw-toggle">
            <button class="p2p-withdraw-toggle-btn retiro active" type="button" id="p2pWithdrawKindRetiro" onclick="window.p2pWithdrawSetKind('retiro')">💸 Retiro</button>
            <button class="p2p-withdraw-toggle-btn gasto" type="button" id="p2pWithdrawKindGasto" onclick="window.p2pWithdrawSetKind('gasto')">🧾 Gasto</button>
          </div>
          <div class="p2p-withdraw-ppm-btn" title="Completa el monto con el PPM calculado del mes elegido">
            📊 PPM <input type="month" id="p2pPpmMonthInput" value="${p2pPrevMonth}">
            <button type="button" onclick="window.p2pUseMonthPpm()">Usar</button>
          </div>
        </div>

        <div class="p2p-withdraw-fields">
          <div class="p2p-withdraw-field" id="p2pWithdrawPersonWrap">
            <label>Quién retira</label>
            <input id="p2pWithdrawPerson" type="text" placeholder="Ej: Josber">
          </div>
          <div class="p2p-withdraw-field" id="p2pWithdrawConceptWrap" style="display:none;">
            <label>Concepto del gasto</label>
            <input id="p2pWithdrawConcept" type="text" placeholder="Ej: PPM agosto">
          </div>
          <div class="p2p-withdraw-field">
            <label>Monto (USDT)</label>
            <input id="p2pWithdrawAmount" type="number" step="0.01" min="0" placeholder="0.00">
          </div>
          <div class="p2p-withdraw-field">
            <label>Fecha</label>
            <input id="p2pWithdrawDate" type="date" value="${p2pTodayStr}">
          </div>
          <div class="p2p-withdraw-field" style="grid-column:1/-1;">
            <label>Nota (opcional)</label>
            <input id="p2pWithdrawNote" type="text" placeholder="Detalle adicional...">
          </div>
        </div>

        <div class="p2p-withdraw-submit-row">
          <div class="p2p-withdraw-error" id="p2pWithdrawError"></div>
          <button class="p2p-withdraw-submit-btn" type="button" id="p2pWithdrawSubmitBtn" onclick="window.p2pWithdrawRegister()">💸 Registrar retiro</button>
        </div>

        <div class="p2p-withdraw-list" id="p2pWithdrawList"></div>
      </div>
    `;
  };

  window.openP2PRangeDetailModal = function openP2PRangeDetailModal(range, exchange){
    window.__p2pModalExchange = exchange || window.__p2pResumenExchange || "binance";
    let modal = document.getElementById("p2pRangeDetailModal");
    if(modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "p2pRangeDetailModal";
    modal.style.cssText = `
      position:fixed;
      inset:0;
      z-index:99999;
      display:flex;
      align-items:flex-start;
      justify-content:center;
      padding:18px;
      overflow-y:auto;
      background:rgba(2,6,23,.76);
      backdrop-filter:blur(10px);
    `;

    modal.innerHTML = `
      <div style="
        width:min(920px,100%);
        margin:auto;
        max-height:90vh;
        overflow:auto;
        border:1px solid rgba(52,211,153,.25);
        background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));
        border-radius:24px;
        padding:22px;
        color:#f8fafc;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;">
          <div>
            <div style="font-size:22px;font-weight:1000;">📊 Estadísticas</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:5px;">
              Resumen inteligente de capital, capacity y rendimiento por rango.
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="p2p-detail-capital-btn" type="button" onclick="setP2PInitialCapital()" title="Definir capital inicial P2P" aria-label="Definir capital inicial P2P" style="
              height:36px;
              border-radius:999px;
              border:1px solid rgba(52,211,153,.35);
              background:rgba(52,211,153,.12);
              color:#34d399;
              cursor:pointer;
              font-size:14px;
              font-weight:950;
              display:inline-flex;
              align-items:center;
              justify-content:center;
              gap:6px;
              padding:0 12px;
            ">💰 Capital</button>

            <button type="button" onclick="document.getElementById('p2pRangeDetailModal')?.remove()" style="
            width:36px;
            height:36px;
            border-radius:999px;
            border:1px solid rgba(148,163,184,.25);
            background:rgba(15,23,42,.85);
            color:#cbd5e1;
            cursor:pointer;
            font-size:20px;
          ">×</button>
          </div>
        </div>

        <div id="p2pRangeDetailContent"></div>
      </div>
    `;

    document.body.appendChild(modal);
    // % de PPM y total retirado se cargan frescos cada vez que se abre el
    // modal (no cambian seguido) -- mismo patrón que el modal de
    // Estadísticas del socio.
    Promise.all([
      fetch('/api/p2p/ppm-config').then(r => r.json()).catch(() => ({ ok: false })),
      fetch('/api/p2p/withdrawals').then(r => r.json()).catch(() => ({ ok: false })),
    ]).then(([ppmRes, wRes]) => {
      window.__p2pPpmPct = (ppmRes.ok && ppmRes.value !== null && ppmRes.value !== undefined) ? Number(ppmRes.value) : null;
      if(wRes.ok){
        window.__p2pWithdrawalsRaw = wRes.withdrawals || [];
        window.recomputeP2PTotalWithdrawn();
      }
      renderP2PRangeDetailContent(range || "today");
      window.p2pWithdrawRenderList();
    });
    renderP2PRangeDetailContent(range || "today");
  };

  // ───────── Retiros y gastos (Capital P2P propio) — pedido explícito del
  // usuario (ago 2026): mismo mecanismo que ya tiene el socio (ver
  // socioBnRegisterWithdrawal más abajo en este archivo), llevado a
  // Métricas P2P. "Retiro" = alguien saca plata, "Gasto" = un gasto del
  // negocio (ej: pago del PPM) -- ambos restan igual del Capital P2P.
  window.__p2pWithdrawKind = 'retiro';
  window.p2pWithdrawSetKind = function(kind){
    window.__p2pWithdrawKind = kind === 'gasto' ? 'gasto' : 'retiro';
    const isGasto = window.__p2pWithdrawKind === 'gasto';
    const btnRetiro = document.getElementById('p2pWithdrawKindRetiro');
    const btnGasto = document.getElementById('p2pWithdrawKindGasto');
    const personWrap = document.getElementById('p2pWithdrawPersonWrap');
    const conceptWrap = document.getElementById('p2pWithdrawConceptWrap');
    const submitBtn = document.getElementById('p2pWithdrawSubmitBtn');
    if(btnRetiro) btnRetiro.classList.toggle('active', !isGasto);
    if(btnGasto) btnGasto.classList.toggle('active', isGasto);
    if(personWrap) personWrap.style.display = isGasto ? 'none' : '';
    if(conceptWrap) conceptWrap.style.display = isGasto ? '' : 'none';
    if(submitBtn) submitBtn.textContent = isGasto ? '🧾 Registrar gasto' : '💸 Registrar retiro';
  };

  window.p2pWithdrawRegister = async function(){
    const kind = window.__p2pWithdrawKind === 'gasto' ? 'gasto' : 'retiro';
    const personEl = document.getElementById('p2pWithdrawPerson');
    const conceptEl = document.getElementById('p2pWithdrawConcept');
    const amountEl = document.getElementById('p2pWithdrawAmount');
    const dateEl = document.getElementById('p2pWithdrawDate');
    const noteEl = document.getElementById('p2pWithdrawNote');
    const errorEl = document.getElementById('p2pWithdrawError');
    if(errorEl) errorEl.textContent = '';

    const person = kind === 'gasto' ? (conceptEl?.value || '').trim() : (personEl?.value || '').trim();
    if(!person){
      if(errorEl) errorEl.textContent = kind === 'gasto' ? 'Ingresa el concepto del gasto (ej: PPM agosto).' : 'Ingresa quién retira.';
      return;
    }
    const amount = Number(amountEl?.value);
    if(!isFinite(amount) || amount <= 0){
      if(errorEl) errorEl.textContent = 'Ingresa un monto válido en USDT.';
      return;
    }
    const res = await fetch('/api/p2p/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        person,
        amountUsdt: amount,
        withdrawnAt: dateEl?.value ? dateEl.value + 'T12:00:00.000Z' : undefined,
        note: noteEl?.value || undefined,
      }),
    });
    const r = await res.json();
    if(r.ok){
      if(amountEl) amountEl.value = '';
      if(noteEl) noteEl.value = '';
      if(conceptEl) conceptEl.value = '';
      if(personEl) personEl.value = '';
      await window.loadP2PWithdrawalsFromServer();
      // renderP2PRangeDetailContent reconstruye TODO el modal (incluyendo un
      // <div id="p2pWithdrawList"> nuevo y vacío) -- por eso p2pWithdrawRenderList()
      // va DESPUÉS, no antes: si fuera antes, llenaría un div que esta línea
      // está por reemplazar/tirar, y la lista quedaría vacía hasta cerrar y
      // volver a abrir el modal (bug real confirmado en vivo, ago 2026).
      if(typeof renderP2PRangeDetailContent === 'function') renderP2PRangeDetailContent(window.__p2pLastRange || 'today');
      window.p2pWithdrawRenderList();
      if(typeof showToast === 'function') showToast(kind === 'gasto' ? 'Gasto registrado' : 'Retiro registrado');
    } else if(errorEl){
      errorEl.textContent = r.error || (kind === 'gasto' ? 'Error al registrar el gasto' : 'Error al registrar el retiro');
    }
  };

  window.p2pWithdrawDelete = async function(id){
    const res = await fetch('/api/p2p/withdrawals', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const r = await res.json();
    if(r.ok){
      await window.loadP2PWithdrawalsFromServer();
      // Mismo orden que en p2pWithdrawRegister -- reconstruir el modal
      // primero, LUEGO llenar la lista (ver comentario ahí arriba).
      if(typeof renderP2PRangeDetailContent === 'function') renderP2PRangeDetailContent(window.__p2pLastRange || 'today');
      window.p2pWithdrawRenderList();
    } else if(typeof showToast === 'function'){
      showToast(r.error || 'Error al borrar', 'error');
    }
  };

  // Lista TODO el historial (no filtrado por el rango Hoy/Semana/Mes de
  // arriba) -- el capital es siempre acumulado, así que ver todos los
  // movimientos acá es más simple y directo que atarlo al filtro de rango.
  window.p2pWithdrawRenderList = async function(){
    const listEl = document.getElementById('p2pWithdrawList');
    if(!listEl) return;
    const res = await fetch('/api/p2p/withdrawals');
    const r = await res.json();
    const rows = r.ok ? (r.withdrawals || []) : [];
    if(!rows.length){
      listEl.innerHTML = '<div class="p2p-withdraw-empty">Sin retiros ni gastos registrados todavía.</div>';
      return;
    }
    listEl.innerHTML = rows.map(function(w){
      const d = new Date(w.withdrawnAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const isGasto = w.kind === 'gasto';
      return `<div class="p2p-withdraw-row">
        <span class="p2p-withdraw-badge ${isGasto ? 'gasto' : 'retiro'}">${isGasto ? '🧾' : '💸'}</span>
        <div class="p2p-withdraw-row-body">
          <div class="p2p-withdraw-row-name">${w.person}</div>
          <div class="p2p-withdraw-row-meta">${d}${w.note ? ' · ' + w.note.replace(/</g,'&lt;') : ''}</div>
        </div>
        <span class="p2p-withdraw-row-amount">-${p2pCapMoney(w.amountUsdt, 2)} USDT</span>
        <button type="button" class="p2p-withdraw-del-btn" onclick="window.p2pWithdrawDelete(${w.id})" title="Borrar">×</button>
      </div>`;
    }).join('');
  };

  // Autocompleta el formulario de arriba en modo "Gasto" con el PPM del mes
  // elegido en el selector -- el PPM se paga los primeros días del mes
  // SIGUIENTE (ej: el 5 de agosto se retira el PPM de julio), por eso el
  // selector arranca en el mes anterior. Todo el cálculo es en el navegador
  // (los datos de ventas de ONZE ya están cargados en memoria vía
  // calculateP2PCapacityStats), no hace falta ir al servidor por eso.
  window.p2pUseMonthPpm = async function(){
    const monthInput = document.getElementById('p2pPpmMonthInput');
    const month = monthInput?.value;
    if(!month){
      if(typeof showToast === 'function') showToast('Elige el mes del PPM a retirar', 'error');
      return;
    }
    const res = await fetch('/api/p2p/ppm-config');
    const ppmRes = await res.json();
    const pct = (ppmRes.ok && ppmRes.value !== null && ppmRes.value !== undefined) ? Number(ppmRes.value) : null;
    if(pct === null){
      if(typeof showToast === 'function') showToast('Configura primero el % de PPM (tarjeta de arriba)', 'error');
      return;
    }

    const stats = calculateP2PCapacityStats();
    const savedFrom = window.__p2pCustomFrom, savedTo = window.__p2pCustomTo;
    window.__p2pCustomFrom = month + '-01';
    window.__p2pCustomTo = month + '-31';
    const data = getP2PRangeStatsFromCapacity(stats, 'custom'); // sin exchange = combinado, como Capital P2P
    window.__p2pCustomFrom = savedFrom;
    window.__p2pCustomTo = savedTo;

    const clpReceived = Number(data.clpReceived || 0);
    const avgSell = Number(data.avgSellPrice || 0);
    const ppmUsdt = avgSell > 0 ? (clpReceived * (pct / 100)) / avgSell : 0;

    window.p2pWithdrawSetKind('gasto');
    const conceptEl = document.getElementById('p2pWithdrawConcept');
    const amountEl = document.getElementById('p2pWithdrawAmount');
    const monthLabel = new Date(month + '-01T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    if(conceptEl) conceptEl.value = 'PPM ' + monthLabel;
    if(amountEl) amountEl.value = ppmUsdt.toFixed(2);
  };

  // % de PPM propio de ONZE -- espejo de socioBnOpenPpmModal, guardado en
  // Tenant.p2pPpmPct (una sola bolsa por tenant, ver /api/p2p/ppm-config).
  window.p2pOpenPpmModal = function(){
    let modal = document.getElementById('p2pPpmModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'p2pPpmModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:1000002;display:flex;align-items:center;justify-content:center;padding:20px;';

    const current = window.__p2pPpmPct;
    modal.innerHTML = `
      <div style="background:#071828;border:1px solid #1a3a5a;border-radius:16px;padding:24px;max-width:420px;width:100%;">
        <h3 style="color:#00d4ff;margin-bottom:8px;">% de PPM (SII)</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:16px;">Porcentaje a aplicar sobre el CLP recibido del período para estimar el PPM a pagar. Confírmalo con tu contadora.</p>
        <input id="p2pPpmInput" type="number" step="0.01" min="0" max="100" placeholder="Ej: 1.5" value="${current !== null && current !== undefined ? current : ''}" style="
          width:100%;padding:10px;border-radius:8px;border:1px solid #2a4a6a;background:#0a1929;color:#fff;font-size:14px;margin-bottom:8px;
        ">
        <div id="p2pPpmError" style="color:#fca5a5;font-size:12px;min-height:16px;margin-bottom:10px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" onclick="document.getElementById('p2pPpmModal')?.remove()" style="padding:8px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
          <button type="button" onclick="window.p2pSavePpm()" style="padding:8px 16px;background:#00d4ff;color:#001824;border:none;border-radius:6px;cursor:pointer;font-weight:800;">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.p2pSavePpm = async function(){
    const input = document.getElementById('p2pPpmInput');
    const error = document.getElementById('p2pPpmError');
    const value = Number(input?.value);
    if(!isFinite(value) || value < 0 || value > 100){
      if(error) error.textContent = 'Ingresa un porcentaje válido (0-100).';
      return;
    }
    const res = await fetch('/api/p2p/ppm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const r = await res.json();
    if(r.ok){
      window.__p2pPpmPct = r.value;
      document.getElementById('p2pPpmModal')?.remove();
      if(typeof renderP2PRangeDetailContent === 'function') renderP2PRangeDetailContent(window.__p2pLastRange || 'today');
      if(typeof showToast === 'function') showToast('% de PPM guardado');
    } else if(error){
      error.textContent = r.error || 'Error al guardar';
    }
  };

  // Pestaña activa del "Resumen P2P" (Binance/Bybit). Capital P2P (más abajo)
  // SIEMPRE se calcula sin este filtro -- es una sola bolsa compartida entre
  // los dos exchanges, no debe cambiar según la pestaña.
  window.__p2pResumenExchange = window.__p2pResumenExchange || "binance";

  window.setP2PResumenExchange = function setP2PResumenExchange(exchange){
    window.__p2pResumenExchange = exchange;
    document.getElementById("p2pResumenTabBinance")?.classList.toggle("active", exchange === "binance");
    document.getElementById("p2pResumenTabBybit")?.classList.toggle("active", exchange === "bybit");
    document.getElementById("p2pResumenTabOkx")?.classList.toggle("active", exchange === "okx");
    document.getElementById("p2pResumenTabTotal")?.classList.toggle("active", exchange === "all");
    updateP2PDashboardWithCapacity();
  };

  // Etiqueta legible para un exchange (o "all" = Total combinado) -- usada
  // tanto en el resumen principal como en el modal de métricas.
  function p2pExchangeDisplayLabel(exchange){
    if(exchange === "all") return "Total";
    if(exchange === "okx") return "OKX";
    return exchange.charAt(0).toUpperCase() + exchange.slice(1);
  }

  window.updateP2PDashboardWithCapacity = function updateP2PDashboardWithCapacity(){
    const stats = calculateP2PCapacityStats();
    const activeExchange = window.__p2pResumenExchange || "binance";
    const today = getP2PRangeStatsFromCapacity(stats, "today", activeExchange);
    const exLabel = p2pExchangeDisplayLabel(activeExchange);
    const capitalLabelEl = document.getElementById("p2pDashCapitalLabel");
    if(capitalLabelEl) capitalLabelEl.textContent = "USDT vendidos " + exLabel;
    const profitTodayLabelEl = document.getElementById("p2pDashProfitTodayLabel");
    if(profitTodayLabelEl) profitTodayLabelEl.textContent = "CLP recibido " + exLabel;

    const soldEl = document.getElementById("p2pDashCapital");
    const clpEl = document.getElementById("p2pDashProfitToday");
    const realProfitEl = document.getElementById("p2pDashProfitMonth");
    const realProfitSubEl = document.getElementById("p2pDashProfitMonthSub");
    const capitalEl = document.getElementById("p2pDashVolume");
    const capitalSubEl = document.getElementById("p2pDashVolumeSub");
    const salesCountEl = document.getElementById("p2pDashCycles");
    const avgEl = document.getElementById("p2pDashAvgProfit");
    const avgSubEl = document.getElementById("p2pDashAvgProfitSub");

    const soldUsdt = Number(today.soldUsdt || 0);
    const clpReceived = Number(today.clpReceived || today.totalClp || 0);
    const profitUsdt = Number(today.profitUsdt || 0);
    const profitClp = Number(today.profitClp || 0);
    const profitPct = Number(today.profitPct || 0);
    const salesCount = Number(today.salesCount || today.ordersCount || today.count || 0);
    const avgSellPrice = soldUsdt > 0 ? clpReceived / soldUsdt : 0;

    if(soldEl){
      soldEl.textContent = `${p2pCapMoney(soldUsdt, 2)} USDT`;
    }

    if(clpEl){
      clpEl.textContent = `${p2pCapMoney(clpReceived, 0)} CLP`;
    }

    if(realProfitEl){
      const signUsdt = profitUsdt >= 0 ? "+" : "-";
      realProfitEl.textContent = `${signUsdt}${p2pCapMoney(Math.abs(profitUsdt), 2)} USDT`;
    }

    if(realProfitSubEl){
      const signClp = profitClp >= 0 ? "+" : "-";
      realProfitSubEl.textContent = `Hoy · ${signClp}${p2pCapMoney(Math.abs(profitClp), 0)} CLP`;
    }

    // BUG REAL encontrado y arreglado (ago 2026): esta función tenía SU
    // PROPIA copia del cálculo de "Capital P2P" (capitalEl/capitalSubEl),
    // separada de updateP2PCapitalCard() -- y esa copia nunca recibió el
    // arreglo de jul 2026 (usaba solo la ganancia de ESTE MES, no el total
    // acumulado). Como esta función corre en casi cada sync, competía con
    // updateP2PCapitalCard() por escribir los MISMOS elementos del DOM, y
    // el número visible "parpadeaba" entre las dos fórmulas cada pocos
    // segundos (confirmado en vivo por el usuario, ago 2026). Arreglo:
    // una sola fuente de verdad -- delega siempre en updateP2PCapitalCard().
    if(capitalEl || capitalSubEl){
      updateP2PCapitalCard(stats);
    }

    if(salesCountEl){
      salesCountEl.textContent = String(salesCount);
    }

    if(avgEl){
      avgEl.textContent = avgSellPrice > 0 ? `${p2pCapMoney(avgSellPrice, 2)} CLP` : "0,00 CLP";
    }

    if(avgSubEl){
      avgSubEl.textContent = `Rentabilidad: ${p2pCapMoney(profitPct, 2)}%`;
    }

    ensureP2PDetailButton();

    const capacityPanel = findCapacityPanel();
    if(capacityPanel && !capacityPanel.dataset.capacityReady){
      renderP2PCapacityPanel();
    }
  }

  setTimeout(() => {
    try{
      ensureP2PDetailButton();
      if(typeof updateP2PDashboardWithCapacity === "function") updateP2PDashboardWithCapacity();
    }catch(e){}
  }, 500);

  // Bug real confirmado en vivo (sep 2026): el capacity es de TODA la
  // cuenta (ONZE + ZINPLE juntos, ver P2PCapacity/CAPACITY_KEY -- no llevan
  // label), pero syncBinanceSales() solo trae la etiqueta que está viendo
  // el usuario en ese momento (botActiveLabel). Si el usuario tiene abierta
  // la pestaña ONZE mientras su actividad real es en ZINPLE (o viceversa),
  // las ventas reales de la OTRA cuenta se quedaban desactualizadas en el
  // navegador, distorsionando cuánto le queda disponible a cada capacity --
  // confirmado en vivo: una venta manual de 1.000.000 CLP no se reflejó en
  // el capacity ni en el resumen diario porque el capacity necesitaba ver
  // ventas reales de ZINPLE que esta pestaña nunca había sincronizado.
  // Reproducido con los datos reales del servidor (sin depender del
  // navegador): el algoritmo de asignación en sí es correcto, el problema
  // era pura falta de datos frescos. Por eso el refresco de la pestaña de
  // Capacity trae SIEMPRE ambas cuentas, no solo la que se está mirando.
  // Devuelve una Promise que resuelve cuando AMBAS etiquetas (ONZE y ZINPLE)
  // ya se sincronizaron -- pedido explícito del usuario (sep 2026): el
  // cierre automático de un capacity (autoFinishP2PCapacities) no debe
  // decidir con datos de solo UNA de las dos cuentas mientras la otra
  // todavía está en camino. El caller que quiera esperar a que esto termine
  // antes de decidir algo puede hacer `await syncAllLabelsBinanceSalesForCapacity()`.
  function syncAllLabelsBinanceSalesForCapacity(){
    return Promise.all(["ONZE", "ZINPLE"].map(lbl =>
      fetch('/api/binance/p2p-history?label=' + encodeURIComponent(lbl))
        .then(res => res.json())
        .then(data => {
          if(data.ok && data.orders && data.orders.length){
            saveBinanceSales(data.orders);
            if(typeof autoFinishP2PCapacities === 'function') autoFinishP2PCapacities();
            if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
            if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
          }
        })
        .catch(() => {})
    ));
  }

  function saveBinanceSales(orders){
    // Combina con TODO lo ya guardado (no solo las manuales) — cada sync trae
    // solo la cuenta activa (ONZE o ZINPLE), así que descartar lo demás borraba
    // las ventas de la otra cuenta cada vez que se sincronizaba.
    const existing = loadP2PBinanceOrders();
    const merged = [...orders, ...existing];
    // Deduplicar por orderNumber (la API, más fresca, tiene prioridad)
    const seen = new Set();
    const deduped = [];
    for (const o of merged) {
      const key = o.orderNumber || o.id || Math.random();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(o);
    }
    try{ localStorage.setItem(window.p2pOrdersKey('onze_p2p_binance_orders'), JSON.stringify(deduped)); }catch(e){ console.warn('No se pudo guardar ventas Binance en localStorage (no crítico):', e.message); }
  }
  function getBinanceSales(){
    try{
      const data = localStorage.getItem('onze_binance_sales');
      return data ? JSON.parse(data) : [];
    }catch(e){
      return [];
    }
  }
  window.renderBinanceSalesTable = function renderBinanceSalesTable(){
    const orders = getBinanceSales();
    const table = document.getElementById('binance-sales-table');
    const container = document.getElementById('binance-sales-container');
    const tbody = document.getElementById('binance-sales-tbody');

    if(!tbody) return;

    tbody.innerHTML = '';

    if(orders.length === 0){
      table.style.display = 'none';
      container.style.display = 'block';
      container.textContent = 'Sin operaciones Binance sincronizadas.';
      return;
    }

    container.style.display = 'none';
    table.style.display = 'table';

    orders.forEach(order => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #1a3a5a';
      row.innerHTML = `
        <td style="padding:8px; color:#fff;">${order.orderNumber.slice(-8)}</td>
        <td style="padding:8px; text-align:right; color:#00ff00;">${order.amount.toFixed(2)}</td>
        <td style="padding:8px; text-align:right; color:#00ff00;">${Math.round(order.totalPrice).toLocaleString('es-CL')}</td>
        <td style="padding:8px; text-align:right; color:#fff;">${order.unitPrice.toFixed(2)}</td>
        <td style="padding:8px; text-align:center; color:#aaa; font-size:11px;">${order.orderStatus}</td>
      `;
      tbody.appendChild(row);
    });
  }
  function autoFinishP2PCapacities(){
    // Motor de Capacity del lado del servidor (ver AGENTS.md): mientras esta
    // cuenta esté en modo autoritativo, el cierre AUTOMÁTICO de capacities lo
    // decide el cron del servidor (/api/internal/p2p-capacity-engine), con
    // datos 100% de Neon -- el navegador deja de hacerlo por su cuenta para
    // no competir con datos potencialmente incompletos de esta pestaña. El
    // cierre MANUAL explícito (botón "Completar capacity",
    // finishCapacityManually) no pasa por acá y sigue funcionando igual.
    if(window.__p2pServerAuthority) return;

    // Bug real confirmado en vivo (sep 2026, plata real afectada -- ver
    // AGENTS.md): esta función podía correr y ESCRIBIR en Neon antes de que
    // syncP2PCapitalMarkedSalesFromServer() terminara de cargar la lista de
    // ventas marcadas como "capital propio" por primera vez -- un capacity
    // recién creado se completaba usando esas mismas ventas ya excluidas,
    // quedando congelado con esa plata duplicada para siempre (17.000.000
    // CLP en un caso real). Ahora se niega a cerrar CUALQUIER capacity
    // mientras esa lista no haya cargado al menos una vez -- más vale
    // esperar unos segundos de más que congelar un cálculo con datos
    // incompletos que después no se puede deshacer solo.
    if(!window.__p2pCapitalMarkedSalesLoaded) return;

    const stats = calculateP2PCapacityStats();
    const toFinish = stats.capacities.filter(c =>
      c.status === "active" &&
      Number(c.capacityClp || c.totalCost || 0) > 0 &&
      // Bug real confirmado en vivo (ago 2026, capacity #265): comparaba
      // solo ventas reales (c.clpReceived) contra el monto total, sin
      // sumar los pagos manuales ya hechos (manualPaymentsClp) -- un
      // capacity totalmente cubierto por ventas + pago manual se quedaba
      // "Activo" para siempre. c.pendingClp ya suma ambos (ver el cálculo
      // "inteligente" de coveredClp en calculateP2PCapacityStats), así que
      // usar eso es la forma correcta de saber si ya no queda nada por
      // cubrir. Tolerancia de 1 CLP (moneda sin decimales) — la suma de
      // muchas ventas pequeñas puede quedar unos centavos por debajo del
      // monto exacto por redondeo, sin que eso signifique que falta saldo
      // real por vender.
      Number(c.pendingClp || 0) <= 1
    );
    if(!toFinish.length) return;

    const caps = loadP2PCapacity();
    for(const capStats of toFinish){
      const idx = caps.findIndex(c => c.id === capStats.id);
      if(idx < 0) continue;
      // Bug real confirmado en vivo (sep 2026): usar new Date() acá marca
      // la fecha en que el CÓDIGO nota que el capacity ya está cubierto,
      // no la fecha real en que se cubrió. Si ninguna sesión del panel
      // tenía a mano el dato completo de ventas (ver el fix de sincronía
      // más abajo, en renderP2PCapacityPanel), un capacity de hace semanas
      // podía cerrarse de golpe con la fecha de HOY -- confirmado con 16
      // capacities del 03-sep que se cerraron así el 16-sep. Ahora se usa
      // la fecha de la venta MÁS RECIENTE que lo completó (sí refleja el
      // momento real); solo si no hay ninguna venta real (cubierto puro por
      // pago manual, caso raro en esta función) se usa "ahora".
      const saleParts = capStats.saleParts || [];
      const lastSaleTs = saleParts.reduce((max, p) => {
        const t = new Date(p.createdAt || 0).getTime();
        return t > max ? t : max;
      }, 0);
      const finishedAt = lastSaleTs > 0 ? new Date(lastSaleTs).toISOString() : new Date().toISOString();
      caps[idx] = {
        ...caps[idx],
        status: "finished",
        finishedAt,
        finalSoldUsdt: capStats.usedUsdt,
        finalClpReceived: capStats.clpReceived,
        finalCommissionUsdt: capStats.commissionUsdt,
        finalCommissionClp: capStats.commissionClp,
        finalSaleParts: capStats.saleParts || [],
      };
    }
    saveP2PCapacity(caps);
    // Persistir cada capacity finalizado al servidor
    for(const capStats of toFinish){
      const idx = caps.findIndex(c => c.id === capStats.id);
      if(idx < 0) continue;
      postP2PCapacityToServer(caps[idx]);
    }
    // Refrescar el bot para que tome el siguiente capacity activo
    if(typeof botUpdateBuyPrice === 'function'){
      botUpdateBuyPrice();
    }
  }

  window.syncBinanceSales = function syncBinanceSales(silent = false){
    // Evita que dos sincronizaciones corran en paralelo -- el timer de 15s
    // (initBinanceSalesSync) y el listener de "visibilitychange" pueden
    // disparar dos corridas casi al mismo tiempo. Protección defensiva
    // adicional (ago 2026): la corrupción real de capacity de esa fecha
    // (cuenta de Hector) resultó tener otras dos causas de fondo ya
    // arregladas -- paginación incompleta al leer Binance (ver
    // fetchAllBinanceOrders en app/api/binance/p2p-history/route.ts) y un
    // segundo auto-finish duplicado que corría dentro del bot, en el
    // servidor, sin este candado ni el detalle de ventas (ya eliminado de
    // lib/p2p-bot/engine.ts) -- pero evitar corridas simultáneas acá sigue
    // siendo correcto en general, así que se deja.
    if(window.__p2pSyncInFlight) return;

    // El botón solo existe en la pestaña "Ventas Binance" -- pero esta
    // función también se dispara desde la pestaña de Capacity (ver fix de
    // sep 2026 en renderP2PCapacityPanel) para que el cálculo de capacity
    // no dependa de que el usuario haya visitado esa otra pestaña. Si no
    // hay botón (porque no se está viendo esa pestaña), igual se sincroniza
    // -- solo se omite la animación del botón.
    const btn = document.getElementById('btn-sync-binance-sales');

    window.__p2pSyncInFlight = true;
    const oldText = btn ? btn.textContent : null;
    if(btn){ btn.disabled = true; btn.textContent = 'Sincronizando...'; }

    var lblParam = (typeof botActiveLabel !== 'undefined' && botActiveLabel) ? '?label=' + encodeURIComponent(botActiveLabel) : '';
    fetch('/api/binance/p2p-history' + lblParam)
      .then(res => res.json())
      .then(data => {
        if(data.ok && data.orders){
          saveBinanceSales(data.orders);
          autoFinishP2PCapacities();
          if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
          if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
          if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        }else{
          throw new Error(data.error || 'Error sincronizando');
        }
      })
      .catch(error => {
        console.warn("syncBinanceSales error:", error.message);
        if(!silent) onzeAlert('❌ Error: ' + error.message);
      })
      .finally(() => {
        window.__p2pSyncInFlight = false;
        if(btn){ btn.disabled = false; btn.textContent = oldText; }
      });
  }
  window.initBinanceSalesSync = function initBinanceSalesSync(){
    const btn = document.getElementById('btn-sync-binance-sales');
    if(btn){
      btn.addEventListener('click', syncBinanceSales);
    }
    initManualSaleButton();
    if(typeof window.syncP2PManualSalesFromServer === "function") window.syncP2PManualSalesFromServer();
    if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
    // initP2PDashboard() llama esto UNA vez al abrir el panel, sin importar
    // qué pestaña de "Ventas" se esté viendo -- así que este intervalo corre
    // TODO el día de fondo. El endpoint que llama es barato (lee de
    // P2PBotOrder en la base de datos, no le pide nada en vivo a Binance),
    // y además la pestaña de Capacity ya lo refresca aparte cada ~10s (ver
    // syncAllLabelsBinanceSalesForCapacity) -- 60s acá alcanza de sobra
    // como red de respaldo, sin duplicar tanto trabajo.
    setInterval(() => syncBinanceSales(true), 60000);

    document.addEventListener("visibilitychange", function(){
      if(document.visibilityState === "visible"){
        syncBinanceSales(true);
      }
    });
  }

  // ── Ventas Bybit — espejo simplificado del bloque de Binance de arriba ──
  // Bybit es cuenta única (sin ONZE/ZINPLE) y no cobra comisión; las ventas
  // se guardan en su propia clave de localStorage para no mezclarse con las
  // de Binance, y llegan al capacity compartido a través de
  // calculateP2PCapacityStats() (ver más arriba), que ya las mezcla por
  // fecha real junto con las de Binance.
  function saveBybitSales(orders){
    const existing = loadP2PBybitOrders();
    const merged = [...orders, ...existing];
    const seen = new Set();
    const deduped = [];
    for (const o of merged) {
      const key = o.orderNumber || o.id || Math.random();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(o);
    }
    saveP2PBybitOrders(deduped);
  }

  window.syncBybitSales = function syncBybitSales(silent = false){
    // Devuelve una Promise (resuelve sola si ya hay una sincronización en
    // curso, para que un caller que hace `await syncBybitSales(...)` -- ver
    // autoFinishP2PCapacities -- nunca se quede colgado esperando algo que
    // no va a pasar.
    if(window.__p2pBybitSyncInFlight) return Promise.resolve();
    // Igual que syncBinanceSales: el botón solo existe en la pestaña
    // "Ventas Bybit", pero esta función también se dispara desde la
    // pestaña de Capacity -- si no hay botón, se sincroniza igual.
    const btn = document.getElementById('btn-sync-bybit-sales');

    window.__p2pBybitSyncInFlight = true;
    const oldText = btn ? btn.textContent : null;
    if(btn){ btn.disabled = true; btn.textContent = 'Sincronizando...'; }

    return fetch('/api/bybit/p2p-history')
      .then(res => res.json())
      .then(data => {
        if(data.ok && data.orders){
          saveBybitSales(data.orders);
          if(typeof autoFinishP2PCapacities === 'function') autoFinishP2PCapacities();
          if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
          if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
          if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        }else{
          throw new Error(data.error || 'Error sincronizando');
        }
      })
      .catch(error => {
        console.warn("syncBybitSales error:", error.message);
        if(!silent) onzeAlert('❌ Error: ' + error.message);
      })
      .finally(() => {
        window.__p2pBybitSyncInFlight = false;
        if(btn){ btn.disabled = false; btn.textContent = oldText; }
      });
  }

  window.renderP2PDashboardFromBybit = function renderP2PDashboardFromBybit(){
    const container = document.getElementById("bybit-sales-container");
    if(!container) return;

    const orders = loadP2PBybitOrders();
    const completedSales = orders
      .filter(o => isCompletedSellClp(o))
      .sort((a,b) => getOrderTs(b) - getOrderTs(a));

    if(!completedSales.length){
      container.innerHTML = "Sin operaciones Bybit registradas todavía.";
      return;
    }

    container.innerHTML = completedSales.map(o => {
      const isManual = o._manual || String(o.orderNumber || '').startsWith('manual_');
      const date = o.createdAt ? new Date(o.createdAt).toLocaleString("es-CL", {
        timeZone:"America/Santiago", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"
      }) : "";
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;">
          <div>
            <strong style="color:#f8fafc;">Venta ${p2pMoney(o.amount, 2)} ${o.asset || "USDT"}</strong>
            <div style="color:#00d4ff;font-size:11px;margin-top:3px;font-family:monospace;word-break:break-all;">Orden: ${o.orderNumber || ""}${isManual ? " (manual)" : ""}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${date}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">Comisión: 0 USDT (Bybit no cobra)</div>
          </div>
          <div style="text-align:right;">
            <strong style="color:#34d399;">${p2pMoney(o.unitPrice, 2)} ${o.fiat || "CLP"}</strong>
            <div style="color:#f8fafc;font-size:12px;margin-top:3px;">${p2pMoney(o.totalPrice, 0)} ${o.fiat || "CLP"}</div>
            ${isManual ? `<div style="margin-top:4px;"><button class="btn small danger" type="button" onclick="event.stopPropagation();window.deleteManualSaleBybit('${o.orderNumber}')" title="Borrar venta manual" style="padding:2px 6px;font-size:12px;line-height:1;">🗑️</button></div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  };

  window.deleteManualSaleBybit = async function deleteManualSaleBybit(orderId){
    if(!(await onzeConfirm("¿Eliminar esta venta manual de Bybit?"))) return;
    const orders = loadP2PBybitOrders().filter(o => o.orderNumber !== orderId);
    saveP2PBybitOrders(orders);
    if(typeof window.deleteP2PManualSaleFromServer === "function") window.deleteP2PManualSaleFromServer(orderId);
    if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
    if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
  };

  window.initBybitSalesSync = function initBybitSalesSync(){
    const btn = document.getElementById('btn-sync-bybit-sales');
    if(btn){
      btn.addEventListener('click', syncBybitSales);
    }
    const manualBtn = document.getElementById('btn-manual-sale-bybit');
    if(manualBtn){
      manualBtn.addEventListener('click', () => showManualSaleModal('bybit'));
    }
    if(typeof window.syncP2PManualSalesFromServer === "function") window.syncP2PManualSalesFromServer();
    if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
    // Bug real confirmado en vivo (sep 2026, factura de Vercel disparada):
    // igual que initBinanceSalesSync, esto corre TODO EL DÍA de fondo desde
    // que se abre el panel (initP2PDashboard lo llama una sola vez, sin
    // importar la pestaña) -- pero a diferencia de Binance, el endpoint de
    // Bybit SÍ hace una consulta EN VIVO real (hasta 50 páginas) cada vez
    // que se llama, con fallback a la base de datos solo si esa consulta
    // falla. Cada 15s, sin parar, es exactamente el mismo patrón que ya
    // causó el problema de bank-quota. 60s acá alcanza de sobra -- la
    // pestaña de Capacity ya la refresca aparte cuando hace falta.
    setInterval(() => syncBybitSales(true), 60000);
  }

  // OKX no tiene API conectada todavía (ver lib/p2p-bot/okx-adapter.ts) --
  // solo ventas manuales, sin botón ni intervalo de sincronización.
  window.renderP2PDashboardFromOkx = function renderP2PDashboardFromOkx(){
    const container = document.getElementById("okx-sales-container");
    if(!container) return;

    const orders = loadP2POkxOrders();
    const completedSales = orders
      .filter(o => isCompletedSellClp(o))
      .sort((a,b) => getOrderTs(b) - getOrderTs(a));

    if(!completedSales.length){
      container.innerHTML = "Sin operaciones OKX registradas todavía. OKX solo admite ventas manuales por ahora.";
      return;
    }

    container.innerHTML = completedSales.map(o => {
      const isManual = o._manual || String(o.orderNumber || '').startsWith('manual_');
      const date = o.createdAt ? new Date(o.createdAt).toLocaleString("es-CL", {
        timeZone:"America/Santiago", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"
      }) : "";
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;">
          <div>
            <strong style="color:#f8fafc;">Venta ${p2pMoney(o.amount, 2)} ${o.asset || "USDT"}</strong>
            <div style="color:#00d4ff;font-size:11px;margin-top:3px;font-family:monospace;word-break:break-all;">Orden: ${o.orderNumber || ""}${isManual ? " (manual)" : ""}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${date}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">Comisión: 0 USDT (OKX no cobra)</div>
          </div>
          <div style="text-align:right;">
            <strong style="color:#34d399;">${p2pMoney(o.unitPrice, 2)} ${o.fiat || "CLP"}</strong>
            <div style="color:#f8fafc;font-size:12px;margin-top:3px;">${p2pMoney(o.totalPrice, 0)} ${o.fiat || "CLP"}</div>
            ${isManual ? `<div style="margin-top:4px;"><button class="btn small danger" type="button" onclick="event.stopPropagation();window.deleteManualSaleOkx('${o.orderNumber}')" title="Borrar venta manual" style="padding:2px 6px;font-size:12px;line-height:1;">🗑️</button></div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  };

  window.deleteManualSaleOkx = async function deleteManualSaleOkx(orderId){
    if(!(await onzeConfirm("¿Eliminar esta venta manual de OKX?"))) return;
    const orders = loadP2POkxOrders().filter(o => o.orderNumber !== orderId);
    saveP2POkxOrders(orders);
    if(typeof window.deleteP2PManualSaleFromServer === "function") window.deleteP2PManualSaleFromServer(orderId);
    if(typeof renderP2PDashboardFromOkx === 'function') renderP2PDashboardFromOkx();
    if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
  };

  // Botón "🗑️" dentro del aviso "Ventas sin compra/capacity detectadas".
  // Dos casos:
  // 1) Venta MANUAL -- reusa el borrado ya existente de cada exchange
  //    (que también avisa al servidor, ver /api/p2p/manual-sale).
  // 2) Orden REAL de Binance/Bybit/OKX pero con 0 USDT/0 CLP -- un
  //    registro fantasma sin ningún valor real (confirmado ago 2026: quedó
  //    cacheado en localStorage desde antes del reinicio del módulo P2P).
  //    Como no aporta nada a ningún cálculo, se borra directo del caché
  //    local sin pasar por el servidor -- estas órdenes viejas nunca
  //    llegaron a guardarse ahí (el cutoff del servidor es posterior).
  //    Solo se permite este camino para registros en 0 -- una orden real
  //    con monto real jamás se borra desde acá (ver isPhantom en el HTML).
  window.deleteP2PUnassignedManualSale = async function(orderNumber, exchange, isManual){
    if(isManual){
      if(exchange === "bybit") window.deleteManualSaleBybit(orderNumber);
      else if(exchange === "okx") window.deleteManualSaleOkx(orderNumber);
      else window.deleteManualSale(orderNumber);
      return;
    }

    if(!(await onzeConfirm("¿Borrar este registro en 0 USDT/0 CLP? No tiene ningún valor real, solo estorba en la lista."))) return;

    if(exchange === "bybit"){
      saveP2PBybitOrders(loadP2PBybitOrders().filter(o => o.orderNumber !== orderNumber));
      if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
    } else if(exchange === "okx"){
      saveP2POkxOrders(loadP2POkxOrders().filter(o => o.orderNumber !== orderNumber));
      if(typeof renderP2PDashboardFromOkx === 'function') renderP2PDashboardFromOkx();
    } else {
      saveP2PBinanceOrders(loadP2PBinanceOrders().filter(o => o.orderNumber !== orderNumber));
      if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
    }
    if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
  };

  window.initOkxSalesTab = function initOkxSalesTab(){
    const manualBtn = document.getElementById('btn-manual-sale-okx');
    if(manualBtn){
      manualBtn.addEventListener('click', () => showManualSaleModal('okx'));
    }
    if(typeof window.syncP2PManualSalesFromServer === "function") window.syncP2PManualSalesFromServer();
    if(typeof renderP2PDashboardFromOkx === 'function') renderP2PDashboardFromOkx();
  }

  // Pestaña activa del bloque "Ventas Binance / Ventas Bybit / Ventas OKX"
  // (lista de órdenes) -- independiente de la pestaña del "Resumen P2P" de
  // más arriba.
  window.setP2PVentasExchange = function setP2PVentasExchange(exchange){
    document.getElementById("p2pVentasTabBinance")?.classList.toggle("active", exchange === "binance");
    document.getElementById("p2pVentasTabBybit")?.classList.toggle("active", exchange === "bybit");
    document.getElementById("p2pVentasTabOkx")?.classList.toggle("active", exchange === "okx");
    const binanceContainer = document.getElementById("binance-sales-container");
    const bybitContainer = document.getElementById("bybit-sales-container");
    const okxContainer = document.getElementById("okx-sales-container");
    const binanceControls = document.getElementById("p2pVentasBinanceControls");
    const bybitControls = document.getElementById("p2pVentasBybitControls");
    const okxControls = document.getElementById("p2pVentasOkxControls");
    if(binanceContainer) binanceContainer.style.display = exchange === "binance" ? "" : "none";
    if(bybitContainer) bybitContainer.style.display = exchange === "bybit" ? "" : "none";
    if(okxContainer) okxContainer.style.display = exchange === "okx" ? "" : "none";
    if(binanceControls) binanceControls.style.display = exchange === "binance" ? "flex" : "none";
    if(bybitControls) bybitControls.style.display = exchange === "bybit" ? "flex" : "none";
    if(okxControls) okxControls.style.display = exchange === "okx" ? "flex" : "none";
  };

  window.showManualSaleModal = function showManualSaleModal(presetExchange){
    const stats = calculateP2PCapacityStats();
    const active = (stats.capacities || []).find(c => c.status === "active" && Number(c.capacityClp || 0) > Number(c.clpReceived || 0));
    const buyPrice = active ? Number(active.buyPrice || 0) : 0;
    const remainingClp = active ? Math.max(Number(active.capacityClp || 0) - Number(active.clpReceived || 0), 0) : 0;
    const remainingUsdt = buyPrice > 0 ? remainingClp / buyPrice : 0;

    if(document.getElementById("p2pManualSaleModal")){
      document.getElementById("p2pManualSaleModal").remove();
    }

    const backdrop = document.createElement("div");
    backdrop.id = "p2pManualSaleModal";
    backdrop.className = "p2p-capacity-modal-backdrop";
    backdrop.style.display = "flex";

    backdrop.innerHTML = `
      <div class="p2p-capacity-modal" style="max-width:520px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
          <div>
            <h3 class="section-title" style="margin-bottom:4px;">Registrar venta manual</h3>
            <p class="section-text" style="font-size:13px;">Completa una venta P2P manual — afecta balance diario, capital y ganancia real.</p>
          </div>
          <button class="btn secondary" type="button" id="closeManualSaleModal" style="padding:6px 14px;">Cerrar</button>
        </div>

        <div style="border:1px solid rgba(52,211,153,.2);border-radius:14px;padding:14px;background:rgba(52,211,153,.05);margin-bottom:18px;">
          <div style="font-weight:900;font-size:13px;color:#34d399;margin-bottom:10px;">Capacity activo (referencia)</div>
          <div class="p2p-detail-summary-grid" style="grid-template-columns:1fr 1fr;gap:8px;">
            <div class="p2p-capacity-mini">
              <span>Proveedor</span>
              <strong>${active ? (active.provider || "—") : "Sin capacity activo"}</strong>
            </div>
            <div class="p2p-capacity-mini">
              <span>Precio compra</span>
              <strong>${buyPrice > 0 ? p2pCapMoney(buyPrice, 2) + " CLP" : "—"}</strong>
            </div>
            <div class="p2p-capacity-mini">
              <span>Capacity restante</span>
              <strong>${p2pCapMoney(remainingClp, 0)} CLP</strong>
            </div>
            <div class="p2p-capacity-mini">
              <span>Equivale a</span>
              <strong>${p2pCapMoney(remainingUsdt, 2)} USDT</strong>
            </div>
          </div>
        </div>

        <form id="manualSaleForm" novalidate>
          <div class="p2p-capacity-form">
            <label class="full">
              Exchange
              <select id="manualSaleExchange" onchange="window.__onManualSaleExchangeChange()">
                <option value="binance" ${(presetExchange !== 'bybit' && presetExchange !== 'okx') ? 'selected' : ''}>Binance</option>
                <option value="bybit" ${presetExchange === 'bybit' ? 'selected' : ''}>Bybit (sin comisión)</option>
                <option value="okx" ${presetExchange === 'okx' ? 'selected' : ''}>OKX (sin comisión)</option>
              </select>
            </label>

            <label class="full">
              CLP recibido por la venta
              <input id="manualSaleClp" inputmode="decimal" placeholder="Ej: 50000" required
                oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.');">
            </label>

            <label>
              Precio de venta (CLP/USDT)
              <input id="manualSaleSellPrice" inputmode="decimal" placeholder="Ej: 950">
            </label>

            <label>
              USDT vendidos
              <input id="manualSaleUsdt" inputmode="decimal" placeholder="Se calcula automático" readonly
                style="color:#8aa0ba;">
            </label>

            <label>
              Comisión (%)
              <input id="manualSaleCommissionPct" type="number" step="0.01" value="${getDefaultCommissionPct()}" placeholder="0.14">
              <div style="font-size:11px;color:#8aa0ba;margin-top:3px;">0 USDT para esta venta</div>
            </label>

            <label class="full" style="display:flex;flex-direction:column;gap:6px;">
              <span style="color:#a8b3c7;font-weight:900;font-size:13px;">Resumen</span>
              <div id="manualSaleSummary" style="border:1px solid rgba(148,163,184,.13);border-radius:12px;padding:12px;background:rgba(15,23,42,.5);font-size:13px;color:#c4cdd8;line-height:1.6;">
                Ingresa CLP recibido y precio de venta para ver el resumen.
              </div>
            </label>

            <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
              <button class="btn secondary" type="button" id="cancelManualSale">Cancelar</button>
              <button class="btn" type="submit">Registrar venta</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(backdrop);

    document.getElementById("closeManualSaleModal").addEventListener("click", () => backdrop.remove());
    document.getElementById("cancelManualSale").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if(e.target === backdrop) backdrop.remove(); });

    document.getElementById("manualSaleClp").addEventListener("input", updateManualSalePreview);
    document.getElementById("manualSaleClp").addEventListener("change", updateManualSalePreview);
    document.getElementById("manualSaleSellPrice").addEventListener("input", updateManualSalePreview);
    document.getElementById("manualSaleSellPrice").addEventListener("change", updateManualSalePreview);
    document.getElementById("manualSaleCommissionPct").addEventListener("input", updateManualSalePreview);
    document.getElementById("manualSaleCommissionPct").addEventListener("change", updateManualSalePreview);

    // Bybit y OKX no cobran comisión -- al elegirlos se fija en 0 y se
    // bloquea el campo; al volver a Binance se restaura el valor
    // configurado del bot.
    window.__onManualSaleExchangeChange = function(){
      const exVal = document.getElementById("manualSaleExchange")?.value || "binance";
      const commInput = document.getElementById("manualSaleCommissionPct");
      if(!commInput) return;
      if(exVal === "bybit" || exVal === "okx"){
        commInput.value = "0";
        commInput.readOnly = true;
        commInput.style.opacity = "0.6";
      }else{
        commInput.readOnly = false;
        commInput.style.opacity = "";
        commInput.value = getDefaultCommissionPct();
      }
      updateManualSalePreview();
    };

    // Si se abrió preseleccionando Bybit/OKX, bloquear la comisión en 0 de una vez.
    if(presetExchange === 'bybit' || presetExchange === 'okx') window.__onManualSaleExchangeChange();

    document.getElementById("manualSaleForm").addEventListener("submit", function(e){
      e.preventDefault();

      try {
        const clpRaw = document.getElementById("manualSaleClp")?.value || "";
        const clp = p2pCapNumber(clpRaw);
        if(clp <= 0){ onzeAlert("Ingresa el CLP recibido."); return; }

        const sellPriceRaw = document.getElementById("manualSaleSellPrice")?.value || "";
        const sellPrice = p2pCapNumber(sellPriceRaw);
        if(sellPrice <= 0){ onzeAlert("Ingresa el precio de venta."); return; }

        const usdt = clp / sellPrice;
        const exVal = document.getElementById("manualSaleExchange")?.value || "binance";
        // Bybit y OKX no cobran comisión -- sin importar lo que diga el campo
        // (queda bloqueado en 0 por window.__onManualSaleExchangeChange), se
        // fuerza acá también por seguridad.
        const commissionPctRaw = document.getElementById("manualSaleCommissionPct")?.value || "0.14";
        const commissionPct = (exVal === "bybit" || exVal === "okx") ? 0 : parseFloat(commissionPctRaw);
        if(isNaN(commissionPct) || commissionPct < 0){ onzeAlert("Comisión inválida."); return; }
        const commission = usdt * commissionPct / 100;

        const now = new Date();
        const order = {
          orderNumber: "manual_" + Date.now() + "_" + Math.random().toString(36).slice(2,6),
          tradeType: "SELL",
          asset: "USDT",
          fiat: "CLP",
          amount: usdt,
          totalPrice: clp,
          unitPrice: sellPrice,
          commission: commission,
          orderStatus: "COMPLETED",
          payMethodName: "Manual",
          counterPartNickName: "Manual",
          createTime: now.getTime(),
          createdAt: now.toISOString(),
          _manual: true,
          exchange: exVal,
        };

        if(exVal === "bybit"){
          const bybitOrders = loadP2PBybitOrders();
          bybitOrders.unshift(order);
          saveP2PBybitOrders(bybitOrders);
        }else if(exVal === "okx"){
          const okxOrders = loadP2POkxOrders();
          okxOrders.unshift(order);
          saveP2POkxOrders(okxOrders);
        }else{
          const orders = loadP2PBinanceOrders();
          orders.unshift(order);
          try{ localStorage.setItem(window.p2pOrdersKey("onze_p2p_binance_orders"), JSON.stringify(orders)); }catch(e){ console.warn('No se pudo guardar ventas Binance en localStorage (no crítico):', e.message); }

          try { localStorage.setItem("onze_binance_sales", JSON.stringify(orders)); } catch(e){}
        }

        // Persistir en Neon -- antes esto solo quedaba en localStorage (ver
        // P2PManualSale en prisma/schema.prisma), así que se perdía al
        // limpiar el navegador o entrar desde otro dispositivo.
        postP2PManualSaleToServer(order);

        backdrop.remove();

        // Forzar recalculo y persistir asignaciones a capacities activos
        try {
          const s = calculateP2PCapacityStats();
          const caps = loadP2PCapacity().slice();
          let changed = false;
          for (const capStats of s.capacities) {
            if (capStats.status === "finished" || capStats.status === "_capital") continue;
            const idx = caps.findIndex(c => c.id === capStats.id);
            if (idx < 0) continue;
            const cap = caps[idx];
            const was = Number(cap.clpReceived || 0);
            const now = Number(capStats.clpReceived || 0);
            if (now !== was) {
              cap.clpReceived = now;
              cap.usedUsdt = capStats.usedUsdt;
              cap.commissionUsdt = capStats.commissionUsdt;
              cap.commissionClp = capStats.commissionClp;
              cap.saleParts = capStats.saleParts || [];
              changed = true;
            }
          }
          if (changed) saveP2PCapacity(caps, true);
        } catch(e) { console.warn("Error persisting manual sale:", e); }

        if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
        if(typeof renderP2PDashboardFromBybit === 'function') renderP2PDashboardFromBybit();
        if(typeof renderP2PDashboardFromOkx === 'function') renderP2PDashboardFromOkx();
        if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
        if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        if(typeof renderBinanceSalesTable === 'function') renderBinanceSalesTable();
      } catch(err){
        console.error("Error al registrar venta manual:", err);
        onzeAlert("Error: " + err.message);
      }
    });

    function updateManualSalePreview(){
      const clpRaw = document.getElementById("manualSaleClp")?.value || "";
      const clp = p2pCapNumber(clpRaw);
      const sellPriceRaw = document.getElementById("manualSaleSellPrice")?.value || "";
      const sellPrice = p2pCapNumber(sellPriceRaw);
      const summary = document.getElementById("manualSaleSummary");
      const commHint = document.querySelector("#manualSaleCommissionPct + div");

      const usdtInput = document.getElementById("manualSaleUsdt");

      if(clp <= 0 || sellPrice <= 0){
        if(usdtInput) usdtInput.value = "";
        if(commHint) commHint.textContent = "0 USDT para esta venta";
        summary.innerHTML = "Ingresa CLP recibido y precio de venta para ver el resumen.";
        return;
      }

      const usdt = clp / sellPrice;
      if(usdtInput) usdtInput.value = p2pCapMoney(usdt, 2);

      const commPctRaw = document.getElementById("manualSaleCommissionPct")?.value || "0";
      const commPct = parseFloat(commPctRaw);
      const commUsdt = usdt * commPct / 100;
      const netoUsdt = Math.max(usdt - commUsdt, 0);
      const netoClp = netoUsdt * sellPrice;

      if(commHint) commHint.textContent = p2pCapMoney(commUsdt, 2) + " USDT para esta venta";

      let costInfo = "";
      if(buyPrice > 0){
        const costClp = usdt * buyPrice;
        const profitClp = clp - costClp - commUsdt * sellPrice;
        const profitPct = costClp > 0 ? (profitClp / costClp) * 100 : 0;
        const sign = profitClp >= 0 ? "+" : "";
        const color = profitClp >= 0 ? "#34d399" : "#fb7185";
        costInfo = `
          <div style="display:flex;justify-content:space-between;">
            <span>Costo (${p2pCapMoney(buyPrice, 2)} CLP/USDT)</span>
            <strong style="color:#f8fafc;">${p2pCapMoney(costClp, 0)} CLP</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-weight:900;">Ganancia / Pérdida</span>
            <strong style="color:${color};">${sign}${p2pCapMoney(Math.abs(profitClp), 0)} CLP (${sign}${p2pCapMoney(Math.abs(profitPct), 2)}%)</strong>
          </div>`;
      }

      summary.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;">
            <span>USDT vendidos</span>
            <strong style="color:#f8fafc;">${p2pCapMoney(usdt, 2)} USDT</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span>Precio venta</span>
            <strong style="color:#f8fafc;">${p2pCapMoney(sellPrice, 2)} CLP</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span>Comisión (${p2pCapMoney(commPct, 2)}%)</span>
            <strong style="color:#fb7185;">-${p2pCapMoney(commUsdt, 2)} USDT</strong>
          </div>
          ${costInfo}
          <div style="border-top:1px solid rgba(148,163,184,.13);padding-top:4px;display:flex;justify-content:space-between;">
            <span style="color:#34d399;font-weight:900;">Neto recibido</span>
            <strong style="color:#34d399;">${p2pCapMoney(netoUsdt, 2)} USDT (${p2pCapMoney(netoClp, 0)} CLP)</strong>
          </div>
        </div>
      `;
    }
  };

  function getDefaultCommissionPct(){
    try{
      const el = document.getElementById("botExCommissionPct");
      if(el && el.value) return parseFloat(el.value) || 0.14;
    }catch(e){}
    return 0.14;
  }

  function initManualSaleButton(){
    const btn = document.getElementById("btn-manual-sale");
    if(btn) btn.addEventListener("click", window.showManualSaleModal);
  }

  window.repairP2PCapacity = function(capacityId, carryoverUsdt, carryoverClp, carryoverCommissionUsdt){
    const caps = loadP2PCapacity();
    const idx = caps.findIndex(c => c.id === capacityId);
    if(idx < 0) return false;

    const cap = caps[idx];
    cap.status = "active";
    delete cap.finishedAt;
    delete cap.finalSoldUsdt;
    delete cap.finalClpReceived;
    delete cap.finalCommissionUsdt;
    delete cap.finalCommissionClp;
    delete cap.finalSaleParts;
    delete cap.dailyBuckets;
    delete cap.lockedOrders;
    cap.usedUsdt = carryoverUsdt || 0;
    cap.clpReceived = carryoverClp || 0;
    cap.commissionUsdt = carryoverCommissionUsdt || 0;
    cap.saleParts = [];

    caps[idx] = cap;
    saveP2PCapacity(caps);
    postP2PCapacityToServer(cap);
    return true;
  };

  function initP2PCapacity(){
    addP2PCapacityStyles();
    ensureP2PCapacityModal();
    ensureP2PCapacityDetailModal();
    // Inicializar cache local desde localStorage antes del sync para preservar runtime fields
    if(!window.__p2pCapacityCache || !window.__p2pCapacityCache.length){
      try{
        const local = JSON.parse(localStorage.getItem(CAPACITY_KEY) || '[]');
        window.__p2pCapacityCache = local;
      }catch(e){}
    }
    // Cargar capacities desde la base de datos al iniciar
    if(typeof window.syncP2PCapacityFromServer === 'function'){
      window.syncP2PCapacityFromServer().then(()=>{
        // NO recalcular baseline aquí — la baseline debe mantenerse estable
        // para que las ventas de días anteriores sigan siendo asignadas
        // correctamente a los capacities activos.

        renderP2PCapacityPanel();
        updateP2PDashboardWithCapacity();
      });
      // Auto-refresh cada 30 segundos para detectar cambios de otros dispositivos
      if(!window.__p2pCapacitySyncInterval){
        window.__p2pCapacitySyncInterval = setInterval(()=>{
          window.syncP2PCapacityFromServer();
        }, 30000);
      }
    }
    renderP2PCapacityPanel();
    updateP2PDashboardWithCapacity();

    // Recalcular después de sincronizar Binance.
    const syncBtn = document.getElementById("syncBinanceP2PBtn");
    if(syncBtn && !syncBtn.dataset.capacityHook){
      syncBtn.dataset.capacityHook = "1";
      syncBtn.addEventListener("click", function(){
        setTimeout(function(){
          renderP2PCapacityPanel();
          updateP2PDashboardWithCapacity();
        }, 1800);
      });
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      setTimeout(initP2PCapacity, 700);
      setTimeout(initP2PCapacity, 1800);
    });
  }else{
    setTimeout(initP2PCapacity, 700);
    setTimeout(initP2PCapacity, 1800);
  }

  window.deleteAllP2PCapacities = function(){
    window.__p2pCapacityCache = [];
    localStorage.removeItem(CAPACITY_KEY);
    localStorage.setItem(P2P_MANUAL_MODE_KEY, 'true');
    localStorage.setItem(P2P_LAST_CLEAR_KEY, String(Date.now()));
    window.__p2pCapacityLastClear = Date.now();
    window.__p2pCapacityPendingSync = {};
    if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
    console.log("🧹 Todas las capacities P2P eliminadas localmente. Modo manual activado. Se limpiará el servidor en el próximo sync (30s).");
    if(typeof showToast === 'function') showToast("✅ Capacities limpiadas — modo manual activado");
  };

  // Limpieza completa: capacities + baseline + ventas + capital para empezar de cero
  window.showP2PResetConfirmModal = function(){
    const existing = document.getElementById("p2pResetConfirmModal");
    if(existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "p2pResetConfirmModal";
    backdrop.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(2,6,23,.76);backdrop-filter:blur(10px);";

    backdrop.innerHTML = `
      <div style="width:min(440px,100%);border:1px solid rgba(239,68,68,.35);background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(2,6,23,.98));border-radius:24px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.45);color:#f8fafc;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="font-size:28px;">⚠️</div>
          <div>
            <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;">Resetear P2P</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Esta acción no se puede deshacer</div>
          </div>
        </div>
        <div style="font-size:14px;color:#cbd5e1;line-height:1.6;margin-bottom:20px;">
          Se borrarán permanentemente:
          <ul style="margin:8px 0 0 0;padding-left:20px;color:#94a3b8;font-size:13px;">
            <li>Capacities y cupos</li>
            <li>Ventas Binance</li>
            <li>Capital y profits registrados</li>
            <li>Baseline y carryovers</li>
          </ul>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" onclick="this.closest('#p2pResetConfirmModal').remove()" style="padding:10px 20px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.8);color:#cbd5e1;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;">Cancelar</button>
          <button type="button" id="p2pResetConfirmBtn" style="padding:10px 20px;border:none;background:#ef4444;color:#fff;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;">Sí, resetear todo</button>
        </div>
      </div>
    `;

    backdrop.addEventListener("click", function(e){
      if(e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);

    document.getElementById("p2pResetConfirmBtn").addEventListener("click", function(){
      backdrop.remove();
      executeP2PFullReset();
    });
  };

  window.resetP2PFullFreshStart = function(){
    showP2PResetConfirmModal();
  };

  window.executeP2PFullReset = function(){
    // 1. Limpiar del servidor primero -- /api/p2p/reset también fija
    // TenantSettings.p2pResetCutoff a "ahora", que es la fecha de inicio que
    // TODOS los dispositivos van a leer de ahí en adelante (ver
    // getP2PCapacityBaselineTs). La actualizamos acá mismo, apenas confirma
    // el servidor, para que este mismo navegador no tenga que esperar al
    // próximo sync para verlo reflejado.
    fetch('/api/p2p/reset', { method: 'POST', credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if(data.ok){
          console.log("✅ Datos P2P eliminados del servidor");
          window.__p2pServerResetCutoff = Number(data.cutoff) || Date.now();
          if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
          if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
        }else{
          console.warn("⚠️ No se pudo limpiar servidor:", data.error);
        }
      })
      .catch(e => console.warn("⚠️ Error limpiando servidor:", e));

    // 2. Limpiar local: capacities
    window.__p2pCapacityCache = [];
    window.__p2pCapacityPendingSync = {};
    localStorage.removeItem(CAPACITY_KEY);

    // 4. Limpiar ventas Binance
    localStorage.removeItem(window.p2pOrdersKey('onze_p2p_binance_orders'));
    localStorage.removeItem('onze_binance_sales');
    window.__p2pBinancePage = 1;
    if(typeof renderBinanceSalesTable === 'function') renderBinanceSalesTable();

    // 5. Limpiar capital inicial
    localStorage.removeItem(P2P_INITIAL_CAPITAL_KEY);
    localStorage.removeItem(P2P_PROFIT_DAY_KEY);
    localStorage.removeItem(P2P_PROFIT_START_KEY);

    // 6. Limpiar carryovers
    localStorage.removeItem(CARRYOVER_KEY);
    localStorage.removeItem('__p2pCapitalCarryoverDate');
    localStorage.removeItem('__p2pCapitalCarryoverProfit');

    // 7. Limpiar capital propio
    localStorage.removeItem(OWN_CAPITAL_KEY);

    // 8. NOTA: ya no activamos modo manual aquí. El servidor ya está limpio
    //    (POST /api/p2p/reset) y el flag __p2pManualMode causaba que cualquier
    //    capacity nuevo creado en los siguientes 60s fuera borrado del servidor
    //    en el próximo sync. Se mantiene el lastClear para referencia.
    localStorage.setItem(P2P_LAST_CLEAR_KEY, String(Date.now()));
    window.__p2pCapacityLastClear = Date.now();

    if(typeof renderP2PCapacityPanel === 'function') renderP2PCapacityPanel();
    if(typeof updateP2PDashboardWithCapacity === 'function') updateP2PDashboardWithCapacity();
    if(typeof renderP2PDashboardFromBinance === 'function') renderP2PDashboardFromBinance();
    console.log("🧹 RESET COMPLETO P2P: capacities, baseline, ventas, capital limpiados.");
    if(typeof showToast === 'function') showToast("✅ Reset completo — todo listo para empezar de cero");
  };

  }catch(e){ console.error("❌ P2P MODULE ERROR:", e); }
})();

(function(){
  let ajustesCredsLabel = "ONZE";

  function checkBinanceCredentials(){
    const statusEl = document.getElementById('binance-creds-status');
    if(!statusEl) return;
    statusEl.style.background = '#1a3a5a';
    statusEl.style.color = '#aaa';
    statusEl.innerHTML = 'Verificando estado...';
    fetch('/api/binance/credentials?label=' + encodeURIComponent(ajustesCredsLabel), { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if(data.ok && data.configured){
          statusEl.style.background = '#0a3a1a';
          statusEl.style.color = '#00ff88';
          statusEl.innerHTML = '✅ Credenciales configuradas (' + ajustesCredsLabel + ')' +
            (data.updatedAt ? ' · Última actualización: ' + new Date(data.updatedAt).toLocaleDateString('es-CL') : '');
        } else {
          statusEl.style.background = '#3a1a0a';
          statusEl.style.color = '#ff8800';
          statusEl.innerHTML = '⚠️ Credenciales no configuradas para ' + ajustesCredsLabel + '. Ingresa tu API Key y Secret Key.';
        }
      })
      .catch(() => {
        statusEl.style.color = '#ff4444';
        statusEl.innerHTML = '❌ Error verificando credenciales';
      });
  }

  window.ajustesSetCredsLabel = function(label){
    if(label === ajustesCredsLabel) return;
    ajustesCredsLabel = label;
    document.querySelectorAll(".ajustes-acct-btn").forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-label") === label);
    });
    const apiKeyEl = document.getElementById('input-binance-api-key');
    const secretKeyEl = document.getElementById('input-binance-secret-key');
    if(apiKeyEl) apiKeyEl.value = '';
    if(secretKeyEl) secretKeyEl.value = '';
    checkBinanceCredentials();
  };

  function saveBinanceCredentials(){
    const apiKey = document.getElementById('input-binance-api-key')?.value?.trim();
    const secretKey = document.getElementById('input-binance-secret-key')?.value?.trim();
    const btn = document.getElementById('btn-save-binance-creds');

    if(!apiKey || !secretKey){
      onzeAlert('⚠️ Debes ingresar API Key y Secret Key');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Guardando...';

    fetch('/api/binance/credentials', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, secretKey, label: ajustesCredsLabel })
    })
    .then(r => r.json())
    .then(data => {
      if(data.ok){
        document.getElementById('input-binance-api-key').value = '';
        document.getElementById('input-binance-secret-key').value = '';
        checkBinanceCredentials();
        if(typeof showToast === 'function'){
          showToast('✅ Credenciales Binance guardadas correctamente (' + ajustesCredsLabel + ')');
        } else {
          onzeAlert('✅ Credenciales guardadas correctamente');
        }
      } else {
        onzeAlert('❌ Error: ' + (data.error || 'No se pudo guardar'));
      }
    })
    .catch(() => onzeAlert('❌ Error de conexión'))
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Guardar credenciales';
    });
  }

  function initAjustes(){
    const btn = document.getElementById('btn-save-binance-creds');
    if(btn) btn.addEventListener('click', saveBinanceCredentials);

    // Verificar estado cuando se abre la vista
    document.querySelectorAll('.nav-btn').forEach(navBtn => {
      navBtn.addEventListener('click', function(){
        if(this.getAttribute('data-view-target') === 'ajustes'){
          setTimeout(checkBinanceCredentials, 300);
        }
      });
    });

    // Verificar al cargar si ya estamos en ajustes
    if(document.getElementById('view-ajustes')?.classList.contains('active')){
      checkBinanceCredentials();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initAjustes);
  } else {
    initAjustes();
  }
})();
