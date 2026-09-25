
/* ===== ONZE: Cuenta del Socio (Binance separado) =====
   Sección 100% aislada del bot ONZE/ZINPLE: rutas propias (/api/partner/*),
   tablas propias (PartnerAccount/PartnerCapacity/PartnerSale), sin
   localStorage como caché (siempre se recalcula desde el servidor). */
(function(){
  if(window.__onzeSocioBnLoaded) return;
  window.__onzeSocioBnLoaded = true;

  // "Hoy" en hora de Chile, no UTC — Chile va 4h atrás, así que entre las
  // 00:00 y las 04:00 UTC el día calendario UTC ya es "mañana" mientras en
  // Chile sigue siendo "hoy". Debe coincidir con chileDateStr() del backend
  // (app/api/partner/dashboard/route.ts) para que el default no muestre el
  // día equivocado justo en ese horario.
  function socioBnChileToday(){
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function socioBnMoney(n, decimals){
    decimals = decimals === undefined ? 0 : decimals;
    n = Number(n) || 0;
    return n.toLocaleString('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // Bug real confirmado en vivo (jul 2026): el modal de Capital P2P del
  // socio dejó de abrirse por completo después de agregar el historial
  // mensual -- llamaba a p2pMonthLabel(), pero esa función vive en OTRO
  // bloque <script> envuelto en su propio IIFE ("(function(){ ... })()"
  // en la sección de Capacity Externo P2P de ONZE), así que no existe fuera
  // de ese cierre. La llamada lanzaba un ReferenceError DENTRO del .map()
  // de la lista, antes de llegar a modal.classList.add('open') -- por eso
  // el click no hacía nada, ni siquiera abría el modal vacío. Se agrega una
  // copia local en vez de depender de una función de otro bloque de script.
  function socioBnMonthLabel(key){
    const parts = String(key || "").split("-");
    const y = Number(parts[0]), m = Number(parts[1]);
    if(!y || !m) return key || "";
    const names = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return `${names[m - 1] || key} ${y}`;
  }

  function socioBnUid(){
    return 'sbn_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  }

  async function socioBnFetch(url, opts){
    const res = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts||{}));
    return res.json();
  }

  function buildSocioBnView(){
    if(document.getElementById('view-socio-bn')) return;
    const section = document.createElement('section');
    section.className = 'view admin-only-view';
    section.id = 'view-socio-bn';
    section.innerHTML = `
      <section class="section-card">
        <div class="section-top">
          <div>
            <h2 class="section-title" style="font-size:18px;">CUENTA AKI TRANSFERS BINANCE</h2>
          </div>
        </div>

        <div id="socioBnCapitalModalBackdrop" class="p2p-capacity-modal-backdrop">
          <div class="p2p-capacity-modal" style="max-width:420px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
              <div>
                <h3 class="section-title" style="margin-bottom:4px;">Capital P2P inicial</h3>
                <p class="section-text" style="font-size:13px;">Se suma a la ganancia acumulada del mes en curso para mostrar el capital total — mismo cálculo que "Capital P2P" del dashboard ONZE.</p>
              </div>
              <button class="btn secondary" type="button" onclick="window.socioBnCloseCapitalModal()">Cerrar</button>
            </div>
            <div style="border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.45);border-radius:14px;padding:12px 14px;margin-bottom:14px;">
              <div style="font-size:12px;color:#94a3b8;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Historial por mes</div>
              <div id="socioBnMonthlyHistoryList" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
                <div style="font-size:12px;color:#64748b;">Sin datos todavía</div>
              </div>
            </div>
            <form class="p2p-capacity-form" onsubmit="event.preventDefault(); window.socioBnSaveInitialCapital();">
              <label class="full">
                Capital inicial (USDT)
                <input id="socioBnCapitalInput" type="number" step="0.01" min="0" placeholder="Ej: 1000">
              </label>
              <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
                <button class="btn secondary" type="button" onclick="window.socioBnCloseCapitalModal()">Cancelar</button>
                <button class="btn" type="submit">Guardar</button>
              </div>
            </form>
          </div>
        </div>

        <div id="socioBnCredsForm" style="display:none; margin-top:16px; padding:16px; border-radius:12px; background:rgba(255,255,255,.03); border:1px solid rgba(148,163,184,.15);">
          <h3 class="section-title" style="font-size:14px;">Conectar cuenta de Binance del socio</h3>
          <p class="section-text" style="font-size:12px; color:#f59e0b; margin-top:4px;">
            Importante: usa una API key de <strong>SOLO LECTURA</strong> (sin permisos de trading ni retiro) al generarla en Binance.
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            <input type="text" id="socioBnName" placeholder="Nombre (opcional, ej. Socio)" style="flex:1; min-width:160px;" />
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <input type="text" id="socioBnApiKey" placeholder="API Key (solo lectura)" style="flex:1; min-width:220px;" autocomplete="off" />
            <input type="password" id="socioBnSecretKey" placeholder="Secret Key" style="flex:1; min-width:220px;" autocomplete="off" />
          </div>
          <button class="btn" type="button" style="margin-top:10px;" onclick="window.socioBnSaveCreds()">Guardar credenciales</button>
          <div id="socioBnCredsMsg" style="font-size:12px; margin-top:6px;"></div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; flex-wrap:wrap; gap:8px;">
          <h3 class="section-title" style="font-size:14px;">Hoy</h3>
          <button class="btn secondary" type="button" title="Ver estadísticas por mes, día o rango" onclick="window.socioBnOpenStatsModal()">📊</button>
        </div>
        <div class="p2p-dashboard-grid" id="socioBnStatsGrid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); margin-top:10px;">
        </div>

        <h3 class="section-title" style="font-size:14px; margin-top:20px;">Capacity</h3>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; flex-wrap:wrap; gap:8px;">
          <div id="socioBnCapacitySummary" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn secondary" type="button" onclick="window.socioBnOpenCompletedModal()">📋 Completados</button>
            <button class="btn secondary" type="button" onclick="window.socioBnOpenCapacityForm()">+ Agregar capacity</button>
          </div>
        </div>
        <div id="socioBnCapacityList" style="margin-top:10px;"></div>

        <div id="socioBnCapacityModalBackdrop" class="p2p-capacity-modal-backdrop">
          <div class="p2p-capacity-modal">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
              <div>
                <h3 class="section-title" style="margin-bottom:6px;">Registrar capacity del socio</h3>
                <p class="section-text">Compra de USDT a costo para la cuenta de tu socio.</p>
              </div>
              <button class="btn secondary" type="button" onclick="window.socioBnCloseCapacityForm()">Cerrar</button>
            </div>
            <form class="p2p-capacity-form" onsubmit="event.preventDefault(); window.socioBnSaveCapacity();">
              <input type="hidden" id="socioBnCapId" />
              <label>
                Proveedor
                <input type="text" id="socioBnCapProvider" placeholder="Ej: zenna" required>
              </label>
              <label>
                Fecha
                <input type="date" id="socioBnCapDate" required>
              </label>
              <label>
                Capacity en CLP
                <input type="text" inputmode="numeric" id="socioBnCapClp" placeholder="Ej: 2.000.000" oninput="window.socioBnFormatClpInput(this)" required>
              </label>
              <label>
                Tasa compra (CLP/USDT)
                <input type="number" id="socioBnCapBuyPrice" step="0.0001" placeholder="Ej: 927.50" oninput="window.socioBnRecalcUsdt()" required>
              </label>
              <label class="full">
                USDT a recibir
                <input type="text" id="socioBnCapUsdt" readonly placeholder="Se calcula automático">
              </label>
              <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
                <button class="btn secondary" type="button" onclick="window.socioBnCloseCapacityForm()">Cancelar</button>
                <button class="btn" type="submit">Guardar capacity</button>
              </div>
            </form>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; flex-wrap:wrap; gap:8px;">
          <h3 class="section-title" style="font-size:14px;">Ventas (todo el historial)</h3>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn secondary" type="button" style="background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.25);color:#fbbf24;" onclick="window.socioBnOpenManualSaleModal()">✚ Manual</button>
            <button class="btn secondary" type="button" id="socioBnSyncBtn" onclick="window.socioBnSync()">🔄 Sincronizar ventas</button>
          </div>
        </div>
        <div id="socioBnSalesTable" style="margin-top:10px; overflow-x:auto;"></div>

        <div id="socioBnManualSaleModalBackdrop" class="p2p-capacity-modal-backdrop">
          <div class="p2p-capacity-modal" style="max-width:520px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
              <div>
                <h3 class="section-title" style="margin-bottom:4px;">Registrar venta manual</h3>
                <p class="section-text" style="font-size:13px;">Se guarda igual que una venta real de Binance — entra en el reparto de capacity, la ganancia y las estadísticas.</p>
              </div>
              <button class="btn secondary" type="button" onclick="window.socioBnCloseManualSaleModal()">Cerrar</button>
            </div>
            <form class="p2p-capacity-form" onsubmit="event.preventDefault(); window.socioBnSaveManualSale();">
              <label class="full">
                CLP recibido por la venta
                <input id="socioBnManualClp" inputmode="numeric" placeholder="Ej: 50.000" oninput="window.socioBnFormatClpInput(this); window.socioBnUpdateManualSalePreview();" required>
              </label>
              <label>
                Precio de venta (CLP/USDT)
                <input id="socioBnManualSellPrice" type="number" step="0.01" placeholder="Ej: 935" oninput="window.socioBnUpdateManualSalePreview()" required>
              </label>
              <label>
                USDT vendidos
                <input id="socioBnManualUsdt" readonly placeholder="Se calcula automático">
              </label>
              <label>
                Comisión (%)
                <input id="socioBnManualCommissionPct" type="number" step="0.01" value="0.14" oninput="window.socioBnUpdateManualSalePreview()">
              </label>
              <label>
                Fecha y hora
                <input id="socioBnManualExecutedAt" type="datetime-local">
              </label>
              <label class="full" style="display:flex;flex-direction:column;gap:6px;">
                <span style="color:#a8b3c7;font-weight:900;font-size:13px;">Resumen</span>
                <div id="socioBnManualSaleSummary" style="border:1px solid rgba(148,163,184,.13);border-radius:12px;padding:12px;background:rgba(15,23,42,.5);font-size:13px;color:#c4cdd8;line-height:1.6;">
                  Ingresa CLP recibido y precio de venta para ver el resumen.
                </div>
              </label>
              <div class="full" style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:4px;">
                <button class="btn secondary" type="button" onclick="window.socioBnCloseManualSaleModal()">Cancelar</button>
                <button class="btn" type="submit">Registrar venta</button>
              </div>
            </form>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;">
          <div id="socioBnSalesPager" style="display:flex; align-items:center; gap:10px; font-size:12px;"></div>
          <div id="socioBnConnectedInfo" style="display:none; font-size:11px; color:#64748b;"></div>
        </div>
      </section>
    `;
    document.querySelector('main')?.appendChild(section);
  }

  function addSocioBnNavButton(){
    // Pedido explícito del usuario (ago 2026): AKI TRANSFERS es una línea
    // de negocio de ONZE, no del bot P2P vendible -- nunca se crea el
    // botón para un tenant sin negocio ONZE (evita la carrera con
    // applyTenantFeatureFlags, que corre ANTES de que este botón exista).
    if(!window.HAS_ONZE_CORE_BUSINESS) return;
    const btn = document.querySelector('[data-view-target="socio-bn"]')
      || (() => {
        const target = document.querySelector('[data-view-target="p2p-bot"]')
          || document.querySelector('[data-view-target="p2p-dashboard"]');
        if(!target || !target.parentNode) return null;
        const b = document.createElement('button');
        b.className = 'nav-btn admin-only-control';
        b.type = 'button';
        b.dataset.viewTarget = 'socio-bn';
        b.textContent = 'AKI TRANSFERS';
        target.parentNode.insertBefore(b, target.nextSibling);
        return b;
      })();
    if(!btn) return;
    btn.addEventListener('click', function(){
      if(typeof switchView === 'function') switchView('socio-bn');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.socioBnRefreshAll();
    });
  }

  window.socioBnRefreshAll = async function(){
    await socioBnLoadCredsStatus();
    await socioBnLoadDashboard();
  };

  async function socioBnLoadCredsStatus(){
    const res = await socioBnFetch('/api/partner/credentials');
    const form = document.getElementById('socioBnCredsForm');
    const info = document.getElementById('socioBnConnectedInfo');
    if(!res.ok || !form || !info) return;
    if(res.exists){
      form.style.display = 'none';
      info.style.display = 'flex';
      info.style.alignItems = 'center';
      info.style.gap = '10px';
      info.style.flexWrap = 'wrap';
      const lastSync = res.lastSyncedAt ? new Date(res.lastSyncedAt).toLocaleString('es-CL') : 'nunca';
      info.innerHTML = `
        <span>Conectado${res.name ? ' — ' + res.name : ''}. Última sincronización: ${lastSync}.</span>
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnShowCredsForm()">Cambiar credenciales</button>
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;color:#ef4444;" onclick="window.socioBnDisconnect()">Desconectar</button>
      `;
    } else {
      form.style.display = 'block';
      info.style.display = 'none';
    }
  }

  window.socioBnShowCredsForm = function(){
    const form = document.getElementById('socioBnCredsForm');
    const info = document.getElementById('socioBnConnectedInfo');
    if(form){
      form.style.display = 'block';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if(info) info.style.display = 'none';
  };

  window.socioBnDisconnect = async function(){
    if(!(await onzeConfirm('¿Desconectar la cuenta del socio? Vas a tener que volver a ingresar la API key para reconectarla. Los datos de capacity y ventas ya sincronizadas no se borran.'))) return;
    const res = await socioBnFetch('/api/partner/credentials', { method: 'DELETE' });
    if(res.ok) await socioBnLoadCredsStatus();
  };

  window.socioBnSaveCreds = async function(){
    const apiKey = document.getElementById('socioBnApiKey').value.trim();
    const secretKey = document.getElementById('socioBnSecretKey').value.trim();
    const name = document.getElementById('socioBnName').value.trim();
    const msg = document.getElementById('socioBnCredsMsg');
    if(!apiKey || !secretKey){ msg.textContent = 'Falta la API key o el secret key.'; msg.style.color = '#ef4444'; return; }
    msg.textContent = 'Guardando...'; msg.style.color = '#64748b';
    const res = await socioBnFetch('/api/partner/credentials', { method: 'POST', body: JSON.stringify({ apiKey, secretKey, name }) });
    if(res.ok){
      msg.textContent = 'Guardado ✅'; msg.style.color = '#10b981';
      document.getElementById('socioBnApiKey').value = '';
      document.getElementById('socioBnSecretKey').value = '';
      await socioBnLoadCredsStatus();
    } else {
      msg.textContent = res.error || 'Error al guardar'; msg.style.color = '#ef4444';
    }
  };

  // silent=true para el auto-sync cada 15s (mismo patrón que syncBinanceSales
  // del dashboard ONZE) — el botón SÍ se mueve igual que en ONZE (se ve
  // "clickearse solo" un instante), solo se ocultan el toast/alert de éxito
  // o error para no interrumpir cada 15s.
  window.socioBnSync = async function(silent){
    const btn = document.getElementById('socioBnSyncBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try{
      const res = await socioBnFetch('/api/partner/sync', { method: 'POST' });
      if(res.ok){
        if(!silent && typeof showToast === 'function') showToast(`Sincronizado: ${res.upserted} venta(s) nueva(s)/actualizada(s)`);
        await socioBnLoadCredsStatus();
        await socioBnLoadDashboard();
      } else if(!silent){
        if(typeof showToast === 'function') showToast(res.error || 'Error al sincronizar', 'error');
        else onzeAlert(res.error || 'Error al sincronizar');
      }
    } catch(e){
      // en modo silencioso no interrumpe con un error de red pasajero
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = '🔄 Sincronizar ventas'; }
    }
  };

  // Venta manual — se guarda como PartnerSale igual que una venta real
  // sincronizada de Binance (mismo modelo, mismo endpoint de dashboard),
  // así que corre por el mismo FIFO de capacity y las mismas estadísticas
  // sin ningún camino especial. orderNumber empieza con "manual_" para
  // poder identificarla y borrarla (nunca choca con un número real).
  window.socioBnOpenManualSaleModal = function(){
    const modal = document.getElementById('socioBnManualSaleModalBackdrop');
    if(!modal) return;
    document.getElementById('socioBnManualClp').value = '';
    document.getElementById('socioBnManualSellPrice').value = '';
    document.getElementById('socioBnManualUsdt').value = '';
    document.getElementById('socioBnManualCommissionPct').value = '0.14';
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('socioBnManualExecutedAt').value = now.toISOString().slice(0, 16);
    window.socioBnUpdateManualSalePreview();
    modal.classList.add('open');
  };

  window.socioBnCloseManualSaleModal = function(){
    document.getElementById('socioBnManualSaleModalBackdrop')?.classList.remove('open');
  };

  window.socioBnUpdateManualSalePreview = function(){
    const clp = socioBnParseClp(document.getElementById('socioBnManualClp')?.value);
    const sellPrice = Number(document.getElementById('socioBnManualSellPrice')?.value || 0);
    const commissionPct = Number(document.getElementById('socioBnManualCommissionPct')?.value || 0);
    const usdtEl = document.getElementById('socioBnManualUsdt');
    const summaryEl = document.getElementById('socioBnManualSaleSummary');
    if(!usdtEl || !summaryEl) return;
    if(clp <= 0 || sellPrice <= 0){
      usdtEl.value = '';
      summaryEl.textContent = 'Ingresa CLP recibido y precio de venta para ver el resumen.';
      return;
    }
    const usdt = clp / sellPrice;
    const commission = usdt * commissionPct / 100;
    usdtEl.value = socioBnMoney(usdt, 2);
    summaryEl.innerHTML = `Vendés <strong>${socioBnMoney(usdt, 2)} USDT</strong> a ${socioBnMoney(sellPrice, 2)} CLP/USDT · Comisión: <strong>${socioBnMoney(commission, 4)} USDT</strong> · Recibís: <strong>${socioBnMoney(clp, 0)} CLP</strong>`;
  };

  window.socioBnSaveManualSale = async function(){
    const clp = socioBnParseClp(document.getElementById('socioBnManualClp')?.value);
    const sellPrice = Number(document.getElementById('socioBnManualSellPrice')?.value || 0);
    const commissionPct = Number(document.getElementById('socioBnManualCommissionPct')?.value || 0);
    const executedAtLocal = document.getElementById('socioBnManualExecutedAt')?.value;
    if(clp <= 0){ onzeAlert('Ingresa el CLP recibido.'); return; }
    if(sellPrice <= 0){ onzeAlert('Ingresa el precio de venta.'); return; }
    const executedAt = executedAtLocal ? new Date(executedAtLocal).toISOString() : new Date().toISOString();
    const res = await socioBnFetch('/api/partner/manual-sale', {
      method: 'POST',
      body: JSON.stringify({ clp, sellPrice, commissionPct, executedAt }),
    });
    if(res.ok){
      window.socioBnCloseManualSaleModal();
      if(typeof showToast === 'function') showToast('Venta manual registrada');
      await socioBnLoadDashboard();
    } else if(typeof showToast === 'function') showToast(res.error || 'Error al registrar la venta', 'error');
    else onzeAlert(res.error || 'Error al registrar la venta');
  };

  window.socioBnDeleteManualSale = async function(orderNumber){
    if(!(await onzeConfirm('¿Borrar esta venta manual? Se recalculan las capacidades y estadísticas.'))) return;
    const res = await socioBnFetch('/api/partner/manual-sale?orderNumber=' + encodeURIComponent(orderNumber), { method: 'DELETE' });
    if(res.ok){ await socioBnLoadDashboard(); }
    else if(typeof showToast === 'function') showToast(res.error || 'Error al borrar', 'error');
  };

  // Mismo estilo que la tarjeta de capacity de ONZE (título + insignia de
  // estado + grilla de mini-tarjetas), pero conservando la barra de progreso
  // propia del Socio (en verde) que muestra cuánto lleva cubierto.
  function socioBnCapacityCard(it){
    // clpCoveredDisplay suma el pago manual SOLO para lo que se ve en
    // pantalla (barra de progreso, "Cubierto", mini-tarjeta) — el costo y la
    // ganancia calculados por el servidor siguen usando nada más que las
    // ventas reales (it.clpCovered original), esto no los toca.
    const clpCoveredDisplay = Number(it.clpCovered || 0) + Number(it.manualPaymentClp || 0);
    const pct = it.capacityClp > 0 ? Math.min(100, (clpCoveredDisplay / it.capacityClp) * 100) : 0;
    const usdtARecibir = it.buyPrice > 0 ? it.capacityClp / it.buyPrice : 0;
    // Ganancia sale SOLO de ventas reales (clpCovered/costClp) — nunca del
    // pago manual, mismo criterio que ya usa socioBnOpenCompletedModal.
    const profitClp = Number(it.clpCovered || 0) - Number(it.costClp || 0);
    const profitUsdt = it.buyPrice > 0 ? profitClp / it.buyPrice : 0;
    // Mín. venta: precio de compra ya ajustado por la comisión de Binance
    // (~0.14%) — es el piso real bajo el cual se vendería con pérdida.
    // Misma fórmula que usan las tarjetas de capacity de ONZE.
    const minSellPct = 0.0014;
    const minSellPrice = it.buyPrice > 0 ? it.buyPrice / (1 - minSellPct) : 0;
    return `<div class="p2p-capacity-card" style="margin-top:8px;">
      <div class="p2p-capacity-top" style="align-items:flex-start;">
        <div style="width:100%;">
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;">
            <div class="p2p-capacity-title" style="font-size:15px;line-height:1.2;">${it.provider || '(sin proveedor)'}</div>
            <div class="p2p-capacity-meta" style="font-size:14px;font-weight:950;color:#a8b3c7;">${it.date || ''}</div>
            <span style="display:inline-flex;justify-content:center;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:950;color:${it.status === 'finished' ? '#94a3b8' : '#34d399'};background:${it.status === 'finished' ? 'rgba(148,163,184,.10)' : 'rgba(52,211,153,.12)'};border:1px solid ${it.status === 'finished' ? 'rgba(148,163,184,.20)' : 'rgba(52,211,153,.26)'};">
              ${it.status === 'finished' ? 'Completado' : 'Activo'}
            </span>
          </div>

          <div style="margin-top:16px;display:grid;gap:7px;">
            <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
              Capacity: <span style="color:#f8fafc;font-size:15px;font-weight:950;">${socioBnMoney(it.capacityClp,0)} CLP</span>
            </div>
            <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
              Tasa: <span style="color:#f8fafc;font-size:15px;font-weight:950;">${socioBnMoney(it.buyPrice,2)} CLP/USDT</span>
            </div>
            <div style="color:#a8b3c7;font-weight:900;font-size:15px;line-height:1.25;">
              USDT a recibir: <span style="color:#34d399;font-size:15px;font-weight:950;">${socioBnMoney(usdtARecibir,2)}</span>
            </div>
          </div>

          <div style="height:6px; border-radius:3px; background:rgba(148,163,184,.15); margin-top:12px; width:100%; overflow:hidden;">
            <div style="height:100%; width:${pct}%; background:#34d399;"></div>
          </div>
          <div class="p2p-capacity-meta" style="margin-top:4px;">Cubierto: ${socioBnMoney(clpCoveredDisplay,0)} CLP de ${socioBnMoney(it.capacityClp,0)} CLP (${pct.toFixed(1)}%)</div>
        </div>
      </div>

      <div class="p2p-capacity-mini-grid">
        <div class="p2p-capacity-mini">
          <span>CLP cubierto</span>
          <strong>${socioBnMoney(clpCoveredDisplay,0)} CLP</strong>
        </div>
        <div class="p2p-capacity-mini">
          <span>Restante</span>
          <strong>${socioBnMoney(it.usdtRemaining,2)} USDT</strong>
          <div class="p2p-capacity-meta" style="margin-top:4px;">${socioBnMoney(it.clpPending,0)} CLP</div>
          ${Number(it.manualPaymentClp || 0) > 0 ? `<div class="p2p-capacity-meta" style="margin-top:2px;color:#00d4ff;">Pago manual: ${socioBnMoney(it.manualPaymentClp,0)} CLP</div>` : ''}
        </div>
        <div class="p2p-capacity-mini">
          <span>USDT consumido</span>
          <strong>${socioBnMoney(it.usdtConsumed,2)} USDT</strong>
        </div>
        <div class="p2p-capacity-mini">
          <span>Costo usado</span>
          <strong>${socioBnMoney(it.costClp,0)} CLP</strong>
        </div>
        <div class="p2p-capacity-mini">
          <span>Mín. venta</span>
          <strong style="color:#facc15;">${socioBnMoney(minSellPrice,2)} CLP</strong>
        </div>
        <div class="p2p-capacity-mini">
          <span>Ganancia</span>
          <strong style="color:${profitUsdt >= 0 ? '#34d399' : '#fb7185'};">${profitUsdt >= 0 ? '+' : '-'}${socioBnMoney(Math.abs(profitUsdt),2)} USDT</strong>
          <div class="p2p-capacity-meta" style="margin-top:4px;">${profitClp >= 0 ? '+' : '-'}${socioBnMoney(Math.abs(profitClp),0)} CLP</div>
        </div>
      </div>

      <div class="p2p-capacity-actions-row">
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnOpenCapacityOrders('${it.id}')" title="Ver el detalle de las órdenes que cubrieron este capacity">👁 Detalle</button>
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnEditCapacity('${it.id}')">Editar</button>
        ${it.status !== 'finished' ? `<button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnOpenCompleteCapacity('${it.id}')" title="Registrar un pago manual (ej: le pagaste al proveedor con plata propia) que no viene de una venta">Completar saldo</button>` : ''}
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnToggleCapacityStatus('${it.id}')">${it.status === 'finished' ? 'Reactivar' : 'Marcar completado'}</button>
        <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;color:#ef4444;" onclick="window.socioBnDeleteCapacity('${it.id}')">Eliminar</button>
      </div>
    </div>`;
  }

  function socioBnRenderCapacityList(){
    const list = document.getElementById('socioBnCapacityList');
    if(!list) return;
    const items = window.__socioBnCapacityCache || [];
    const activos = items.filter(function(it){ return it.status !== 'finished'; });
    list.innerHTML = activos.length ? activos.map(socioBnCapacityCard).join('') : '<div class="p2p-dashboard-empty">Sin capacity activo.</div>';

    // Totales de los capacity ACTIVOS (no cuenta los ya completados) — una
    // tarjeta de CLP (total arriba, restante abajo) y una de USDT (total
    // arriba, restante abajo). El restante baja solo a medida que entran
    // ventas que cubren ese CLP — debe coincidir con el capacity real en la
    // plataforma del proveedor.
    const summary = document.getElementById('socioBnCapacitySummary');
    if(summary){
      const totalClp = activos.reduce(function(sum, it){ return sum + Number(it.capacityClp || 0); }, 0);
      const totalUsdt = activos.reduce(function(sum, it){ return sum + Number(it.usdtAmount || 0); }, 0);
      const totalClpPendiente = activos.reduce(function(sum, it){ return sum + Number(it.clpPending || 0); }, 0);
      const totalUsdtRestante = activos.reduce(function(sum, it){ return sum + Number(it.usdtRemaining || 0); }, 0);
      summary.innerHTML = [
        '<div class="p2p-capacity-mini"><span>Total en capacity</span><strong>' + socioBnMoney(totalClp, 0) + ' CLP</strong>'
          + '<div class="p2p-capacity-meta" style="margin-top:5px;">Restante: ' + socioBnMoney(totalClpPendiente, 0) + ' CLP</div></div>',
        '<div class="p2p-capacity-mini"><span>USDT a recibir</span><strong>' + socioBnMoney(totalUsdt, 2) + ' USDT</strong>'
          + '<div class="p2p-capacity-meta" style="margin-top:5px;">Restante: ' + socioBnMoney(totalUsdtRestante, 2) + ' USDT</div></div>',
      ].join('');
    }
  }

  // Modal de capacities completados del socio — mismo patrón que
  // openCompletedCapacitiesModal() de ONZE, pero leyendo del cálculo FIFO
  // servido por /api/partner/dashboard (window.__socioBnCapacityCache), no
  // de finalSaleParts manuales (ese modelo de datos no existe acá a propósito).
  window.socioBnOpenCompletedModal = function(){
    const allItems = (window.__socioBnCapacityCache || []).filter(function(it){ return it.status === 'finished'; })
      .sort(function(a,b){ return new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0); });

    let modal = document.getElementById('socioBnCompletedModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'socioBnCompletedModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';

    function cardHtml(it, index){
      const profitClp = it.clpCovered - it.costClp;
      const profitUsdt = it.buyPrice > 0 ? profitClp / it.buyPrice : 0;
      const minSellPrice = it.buyPrice > 0 ? it.buyPrice / (1 - 0.0014) : 0;
      return `
        <div style="background:#0d2137;border:1px solid #1a3a5a;border-radius:12px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div>
              <strong style="color:#fff;font-size:15px;">#${index + 1} · ${it.provider || 'Proveedor'}</strong>
              <div style="color:#8aa0ba;font-size:12px;margin-top:2px;">${it.date || ''}</div>
            </div>
            <span style="background:#1a3a5a;color:#00d4ff;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:bold;">COMPLETADO</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:13px;">
            <div><span style="color:#8aa0ba;">Capacity:</span><br><strong style="color:#fff;">${socioBnMoney(it.capacityClp,0)} CLP</strong></div>
            <div><span style="color:#8aa0ba;">Tasa:</span><br><strong style="color:#fff;">${socioBnMoney(it.buyPrice,2)} CLP/USDT</strong></div>
            <div><span style="color:#8aa0ba;">USDT consumido:</span><br><strong style="color:#fff;">${socioBnMoney(it.usdtConsumed,2)} USDT</strong></div>
            <div><span style="color:#8aa0ba;">CLP cubierto:</span><br><strong style="color:#fff;">${socioBnMoney(it.clpCovered,0)} CLP</strong></div>
            <div><span style="color:#8aa0ba;">Mín. venta:</span><br><strong style="color:#facc15;">${socioBnMoney(minSellPrice,2)} CLP</strong></div>
            <div><span style="color:#8aa0ba;">Ganancia:</span><br><strong style="color:${profitClp >= 0 ? '#34d399' : '#fb7185'};">${profitClp >= 0 ? '+' : ''}${socioBnMoney(profitClp,0)} CLP</strong><br><strong style="color:${profitClp >= 0 ? '#34d399' : '#fb7185'};font-size:12px;">${profitClp >= 0 ? '+' : ''}${socioBnMoney(profitUsdt,2)} USDT</strong></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnOpenCapacityOrders('${it.id}')" title="Ver el detalle de las órdenes que cubrieron este capacity">👁 Detalle</button>
            <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnToggleCapacityStatus('${it.id}'); document.getElementById('socioBnCompletedModal').remove();">Reactivar</button>
            <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;color:#ef4444;" onclick="window.socioBnDeleteCapacity('${it.id}'); document.getElementById('socioBnCompletedModal').remove();">Eliminar</button>
          </div>
        </div>
      `;
    }

    // Items sin finishedAt (dato legado) se muestran SIEMPRE sin importar
    // el filtro elegido -- así nunca desaparecen de la vista solo por no
    // tener fecha guardada.
    function renderCards(fromStr, toStr){
      const filtered = allItems.filter(function(it){
        const day = p2pChileDayKey(it.finishedAt);
        return !day || (day >= fromStr && day <= toStr);
      });
      const container = document.getElementById('socioBnCompletedCards');
      if(!container) return;
      container.innerHTML = filtered.length === 0
        ? '<div style="text-align:center;color:#8aa0ba;padding:40px;">No hay capacities completados en este rango.</div>'
        : filtered.map(cardHtml).join('');
    }

    const today = p2pChileDayKey();
    function yesterdayStr(){
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }

    modal.innerHTML = `
      <div style="background:#071828;border:1px solid #1a3a5a;border-radius:16px;padding:24px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="color:#00d4ff;margin:0;">📋 Capacities completados</h3>
          <button onclick="document.getElementById('socioBnCompletedModal').remove()"
            style="padding:8px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
        <p style="color:#8aa0ba;font-size:13px;margin-bottom:12px;">Capacities cubiertos al 100% (vendidos completamente).</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
          <button class="btn" type="button" id="socioBnCompletedQuickToday" style="padding:5px 10px;font-size:12px;">Hoy</button>
          <button class="btn secondary" type="button" id="socioBnCompletedQuickYesterday" style="padding:5px 10px;font-size:12px;">Ayer</button>
          <button class="btn secondary" type="button" id="socioBnCompletedRangeToggle" style="padding:5px 10px;font-size:12px;">Rango de fechas</button>
        </div>
        <div id="socioBnCompletedRangeRow" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Desde <input type="date" id="socioBnCompletedFrom" value="${today}" style="font-size:12px;" /></label>
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Hasta <input type="date" id="socioBnCompletedTo" value="${today}" style="font-size:12px;" /></label>
          <button class="btn" type="button" id="socioBnCompletedRangeApply" style="padding:5px 14px;font-size:12px;">Ver</button>
        </div>
        <div id="socioBnCompletedCards"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnToday = document.getElementById('socioBnCompletedQuickToday');
    const btnYesterday = document.getElementById('socioBnCompletedQuickYesterday');
    const btnRangeToggle = document.getElementById('socioBnCompletedRangeToggle');
    const rangeRow = document.getElementById('socioBnCompletedRangeRow');

    function setActiveQuick(which){
      btnToday.className = which === 'today' ? 'btn' : 'btn secondary';
      btnYesterday.className = which === 'yesterday' ? 'btn' : 'btn secondary';
      btnRangeToggle.className = which === 'range' ? 'btn' : 'btn secondary';
    }

    btnToday.addEventListener('click', function(){
      rangeRow.style.display = 'none';
      setActiveQuick('today');
      renderCards(today, today);
    });
    btnYesterday.addEventListener('click', function(){
      rangeRow.style.display = 'none';
      setActiveQuick('yesterday');
      const y = yesterdayStr();
      renderCards(y, y);
    });
    btnRangeToggle.addEventListener('click', function(){
      setActiveQuick('range');
      rangeRow.style.display = rangeRow.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('socioBnCompletedRangeApply').addEventListener('click', function(){
      const from = document.getElementById('socioBnCompletedFrom').value || today;
      const to = document.getElementById('socioBnCompletedTo').value || today;
      renderCards(from, to);
    });

    setActiveQuick('today');
    renderCards(today, today);
  };

  function socioBnParseClp(value){
    const digits = String(value || '').replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  window.socioBnFormatClpInput = function(el){
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? Number(digits).toLocaleString('es-CL') : '';
    window.socioBnRecalcUsdt();
  };

  // USDT a recibir = monto CLP / tasa de compra — se recalcula solo, nunca
  // se carga a mano (evita que quede desincronizado con los otros 2 valores).
  window.socioBnRecalcUsdt = function(){
    const clpEl = document.getElementById('socioBnCapClp');
    const priceEl = document.getElementById('socioBnCapBuyPrice');
    const usdtEl = document.getElementById('socioBnCapUsdt');
    if(!clpEl || !priceEl || !usdtEl) return;
    const clp = socioBnParseClp(clpEl.value);
    const price = Number(priceEl.value) || 0;
    usdtEl.value = (clp > 0 && price > 0) ? (clp / price).toFixed(8) : '';
  };

  window.socioBnOpenCapacityForm = function(item){
    document.getElementById('socioBnCapId').value = item?.id || '';
    document.getElementById('socioBnCapProvider').value = item?.provider || '';
    document.getElementById('socioBnCapDate').value = item?.date || socioBnChileToday();
    document.getElementById('socioBnCapClp').value = item?.capacityClp != null ? Number(item.capacityClp).toLocaleString('es-CL') : '';
    document.getElementById('socioBnCapBuyPrice').value = item?.buyPrice ?? '';
    window.socioBnRecalcUsdt();
    document.getElementById('socioBnCapacityModalBackdrop')?.classList.add('open');
  };

  window.socioBnCloseCapacityForm = function(){
    document.getElementById('socioBnCapacityModalBackdrop')?.classList.remove('open');
  };

  window.socioBnEditCapacity = function(id){
    const item = (window.__socioBnCapacityCache || []).find(function(it){ return it.id === id; });
    if(item) window.socioBnOpenCapacityForm(item);
  };

  window.socioBnSaveCapacity = async function(){
    const id = document.getElementById('socioBnCapId').value || socioBnUid();
    const existing = (window.__socioBnCapacityCache || []).find(function(it){ return it.id === id; });
    const item = {
      id: id,
      provider: document.getElementById('socioBnCapProvider').value.trim(),
      date: document.getElementById('socioBnCapDate').value,
      capacityClp: socioBnParseClp(document.getElementById('socioBnCapClp').value),
      buyPrice: Number(document.getElementById('socioBnCapBuyPrice').value || 0),
      usdtAmount: Number(document.getElementById('socioBnCapUsdt').value || 0),
      status: existing ? existing.status : 'active'
    };
    const res = await socioBnFetch('/api/partner/capacity', { method: 'POST', body: JSON.stringify({ item }) });
    if(res.ok){
      window.socioBnCloseCapacityForm();
      await socioBnLoadDashboard();
    } else if(typeof showToast === 'function') showToast(res.error || 'Error al guardar capacity', 'error');
  };

  // Marcar "completado"/"Reactivar" a mano sigue disponible como excepción
  // manual — el camino normal es automático: cuando el CLP cubierto llega al
  // 100% de capacityClp, el servidor lo pasa a "finished" solo (ver
  // isCompleted en /api/partner/dashboard).
  window.socioBnToggleCapacityStatus = async function(id){
    const item = (window.__socioBnCapacityCache || []).find(function(it){ return it.id === id; });
    if(!item) return;
    const updated = Object.assign({}, item, { status: item.status === 'finished' ? 'active' : 'finished' });
    const res = await socioBnFetch('/api/partner/capacity', { method: 'POST', body: JSON.stringify({ item: updated }) });
    if(res.ok){ await socioBnLoadDashboard(); }
  };

  window.socioBnDeleteCapacity = async function(id){
    if(!(await onzeConfirm('¿Eliminar esta capacity? Esta acción no se puede deshacer.'))) return;
    const res = await socioBnFetch('/api/partner/capacity?id=' + encodeURIComponent(id) + '&confirm=manual', { method: 'DELETE' });
    if(res.ok){ await socioBnLoadDashboard(); }
  };

  // "Completar saldo" — pago manual aparte de las ventas (ej: pagaste al
  // proveedor con plata propia). Se guarda en PartnerCapacityPayment, NUNCA
  // toca capacityClp directo ni las métricas de costo/ganancia — solo resta
  // del saldo pendiente (ver computeFifo en /api/partner/dashboard). Todo se
  // recalcula fresco del servidor al cerrar, como el resto de esta sección.
  window.socioBnOpenCompleteCapacity = function(id){
    const item = (window.__socioBnCapacityCache || []).find(function(it){ return it.id === id; });
    if(!item) { if(typeof showToast === 'function') showToast('Capacity no encontrado', 'error'); return; }

    const pending = Number(item.clpPending || 0);
    let modal = document.getElementById('socioBnCompleteCapacityModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'socioBnCompleteCapacityModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;';
    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:420px;width:90%;">
        <h3 style="color:#00d4ff;margin-bottom:8px;">Completar saldo (pago manual)</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:12px;">
          Proveedor: <strong style="color:#fff;">${item.provider || ''}</strong><br>
          Pendiente hoy: <strong style="color:#00ff88;">${socioBnMoney(pending,0)} CLP</strong>
        </p>
        <p style="color:#aaa;font-size:12px;margin-bottom:8px;">
          Usa esto SOLO para pagos que le hiciste al proveedor por fuera de una venta
          (ej: con plata propia). No afecta el costo ni la ganancia calculados —
          solo reduce el saldo pendiente que se muestra acá.
        </p>
        <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Monto en CLP pagado</label>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <input id="socioBnCompleteAmount" type="text" inputmode="decimal" placeholder="Ej: 200.000"
            oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.');"
            style="flex:1;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;">
          <button type="button" onclick="document.getElementById('socioBnCompleteAmount').value = Math.round(${pending}).toLocaleString('es-CL')"
            style="padding:10px 16px;background:#1a3a5a;color:#00d4ff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">MAX</button>
        </div>
        <label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px;">Nota (opcional)</label>
        <input id="socioBnCompleteNote" type="text" placeholder="Ej: pago directo al proveedor 18/07"
          style="width:100%;padding:10px;background:#071828;border:1px solid #1a3a5a;border-radius:6px;color:#fff;margin-bottom:16px;box-sizing:border-box;">
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" onclick="document.getElementById('socioBnCompleteCapacityModal').remove()"
            style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
          <button type="button" onclick="window.socioBnConfirmCompleteCapacity('${id}')"
            style="padding:10px 16px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.socioBnConfirmCompleteCapacity = async function(capacityId){
    const input = document.getElementById('socioBnCompleteAmount');
    const amountClp = Number((input?.value || '').replace(/[^0-9]/g, ''));
    if(!amountClp || amountClp <= 0){
      if(typeof showToast === 'function') showToast('Ingresa un monto válido', 'error');
      return;
    }
    const note = document.getElementById('socioBnCompleteNote')?.value?.trim() || null;
    const res = await socioBnFetch('/api/partner/capacity/payment', {
      method: 'POST',
      body: JSON.stringify({ capacityId, amountClp, note }),
    });
    if(res.ok){
      document.getElementById('socioBnCompleteCapacityModal')?.remove();
      await socioBnLoadDashboard();
      if(typeof showToast === 'function') showToast('✅ Pago manual registrado');
    } else if(typeof showToast === 'function') showToast(res.error || 'Error al registrar el pago', 'error');
  };

  // "👁 Detalle" — qué órdenes (y pagos manuales) cubrieron este capacity.
  // Se pide fresco al servidor cada vez que se abre (mismo patrón de "Neon
  // manda siempre" que el resto de esta sección) — nunca se arma con datos
  // ya cacheados en el navegador.
  window.socioBnOpenCapacityOrders = async function(capacityId){
    let modal = document.getElementById('socioBnCapacityOrdersModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'socioBnCapacityOrdersModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;';
    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="color:#00d4ff;margin:0;">👁 Detalle del capacity</h3>
          <button onclick="document.getElementById('socioBnCapacityOrdersModal').remove()"
            style="padding:8px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
        <div id="socioBnCapacityOrdersBody" style="color:#8aa0ba;font-size:13px;">Cargando…</div>
      </div>
    `;
    document.body.appendChild(modal);

    const res = await socioBnFetch('/api/partner/capacity/orders?capacityId=' + encodeURIComponent(capacityId));
    const body = document.getElementById('socioBnCapacityOrdersBody');
    if(!body) return;
    if(!res.ok){
      body.innerHTML = '<div style="color:#fb7185;">' + (res.error || 'Error al cargar el detalle') + '</div>';
      return;
    }

    const rows = [
      ...res.orders.map(function(o){ return { kind: 'order', date: o.executedAt, sort: new Date(o.executedAt).getTime(), data: o }; }),
      ...res.manualPayments.map(function(p){ return { kind: 'manual', date: p.createdAt, sort: new Date(p.createdAt).getTime(), data: p }; }),
    ].sort(function(a, b){ return b.sort - a.sort; });

    const header = `
      <div style="margin-bottom:14px;">
        <strong style="color:#fff;font-size:14px;">${res.capacity.provider || '(sin proveedor)'}</strong>
        <div style="margin-top:4px;">Cubierto por ventas: <strong style="color:#34d399;">${socioBnMoney(res.clpCovered,0)} CLP</strong> de ${socioBnMoney(res.capacity.capacityClp,0)} CLP</div>
      </div>
    `;

    if(rows.length === 0){
      body.innerHTML = header + '<div style="text-align:center;padding:24px;">Todavía no hay órdenes ni pagos manuales asignados a este capacity.</div>';
      return;
    }

    const rowsHtml = rows.map(function(r){
      const dateStr = new Date(r.date).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      if(r.kind === 'manual'){
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1a3a5a;">
            <div>
              <div style="color:#00d4ff;font-weight:bold;font-size:13px;">Pago manual${r.data.note ? ' — ' + r.data.note : ''}</div>
              <div style="color:#8aa0ba;font-size:11px;margin-top:2px;">${dateStr}</div>
            </div>
            <div style="text-align:right;color:#00d4ff;font-weight:bold;font-size:13px;">${socioBnMoney(r.data.amountClp,0)} CLP</div>
          </div>
        `;
      }
      const profitClp = Number(r.data.profitClp || 0);
      const profitUsdt = Number(r.data.profitUsdt || 0);
      const profitColor = profitClp >= 0 ? '#34d399' : '#fb7185';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1a3a5a;">
          <div>
            <div style="color:#fff;font-weight:bold;font-size:13px;">Orden ${r.data.orderNumber}</div>
            <div style="color:#8aa0ba;font-size:11px;margin-top:2px;">${dateStr}${r.data.paymentMethod ? ' · ' + r.data.paymentMethod : ''}</div>
            <div style="color:${profitColor};font-size:11px;margin-top:2px;">Ganancia: ${profitClp >= 0 ? '+' : '-'}${socioBnMoney(Math.abs(profitClp),0)} CLP (${profitUsdt >= 0 ? '+' : '-'}${socioBnMoney(Math.abs(profitUsdt),2)} USDT)</div>
          </div>
          <div style="text-align:right;">
            <div style="color:#34d399;font-weight:bold;font-size:13px;">${socioBnMoney(r.data.clpTaken,0)} CLP</div>
            <div style="color:#8aa0ba;font-size:11px;">${socioBnMoney(r.data.usdtTaken,2)} USDT</div>
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = header + rowsHtml;
  };

  window.__socioBnSalesPage = window.__socioBnSalesPage || 1;

  window.socioBnGoPage = function(page){
    window.__socioBnSalesPage = page;
    socioBnLoadDashboard();
  };

  // La pantalla principal siempre muestra HOY (hora de Chile) — sin selector
  // de fecha propio. Para ver otros días/rangos/el mes, está el panel de
  // estadísticas (socioBnOpenStatsModal).
  // Carga atómica: día (stats de "Hoy") + capital inicial + mes en curso (para
  // la tarjeta Capital P2P), las tres en paralelo, y UN solo render del grid
  // — evita que dos renders separados del mismo grid (uno síncrono, uno tras
  // un fetch más lento) se pisen y hagan parpadear o perder una tarjeta.
  async function socioBnLoadDashboard(){
    const today = socioBnChileToday();
    // includeRanges=1 (ago 2026): antes esto disparaba 3 fetches en paralelo
    // a /api/partner/dashboard (hoy / mes / histórico total), cada uno
    // recalculando computeFifo() desde cero con sus propias 3 consultas a
    // la base -- 9 consultas + 3 recorridos completos del FIFO cada 15s,
    // que disparó el uso de CPU en Vercel y provocó caídas reales por falta
    // de memoria (confirmado en logs de producción). Ahora el servidor
    // calcula el FIFO UNA sola vez y devuelve las 3 vistas (día/mes/total)
    // en la MISMA respuesta -- mismas fórmulas, mismos números, solo sin
    // repetir el trabajo 3 veces.
    const params = new URLSearchParams({ date: today, page: String(window.__socioBnSalesPage), limit: '20', includeRanges: '1' });
    const [res, capRes, withdrawalsRes] = await Promise.all([
      socioBnFetch('/api/partner/dashboard?' + params.toString()),
      socioBnFetch('/api/partner/initial-capital'),
      socioBnFetch('/api/partner/withdrawals'), // sin from/to = TODO el historial
    ]);
    if(!res.ok) return;

    // ── Capital P2P — pedido explícito del usuario (ago 2026): el capital
    // inicial NUNCA se toca solo (solo se edita a mano acá), y el total
    // mostrado es siempre: inicial + ganancia acumulada de TODO el
    // historial - retiros acumulados de TODO el historial. Cada retiro
    // registrado se refleja al instante acá, sin necesidad de "cerrar" nada
    // (la función de "cerrar período" que sumaba al capital se eliminó por
    // ser la causa de que un retiro terminara SUMANDO en vez de restar).
    const initial = capRes.ok ? Number(capRes.value || 0) : 0;
    const totalWithdrawnUsdt = withdrawalsRes.ok
      ? (withdrawalsRes.withdrawals || []).reduce((sum, w) => sum + Number(w.amountUsdt), 0)
      : 0;
    const monthStats = res.monthStats || null;
    const totalStats = res.totalStats || null;
    const avgSell = monthStats && monthStats.avgSalePrice ? Number(monthStats.avgSalePrice) : 0;
    const monthProfitClp = monthStats && monthStats.profitClp !== null ? Number(monthStats.profitClp) : 0;
    const monthProfitUsdt = avgSell > 0 ? monthProfitClp / avgSell : 0;
    const totalAvgSell = totalStats && totalStats.avgSalePrice ? Number(totalStats.avgSalePrice) : 0;
    const totalProfitClp = totalStats && totalStats.profitClp !== null ? Number(totalStats.profitClp) : 0;
    const totalProfitUsdt = totalAvgSell > 0 ? totalProfitClp / totalAvgSell : 0;
    window.__socioBnInitialCapital = initial;
    window.__socioBnMonthlyHistory = res.monthlyBreakdown || [];
    // Cacheado para la tarjeta "Capital P2P" del panel de estadísticas (ver
    // socioBnStatsRefresh) -- mismo valor que ya se muestra en la tarjeta
    // principal, sin tener que recalcularlo ahí.
    window.__socioBnMonthProfitUsdt = monthProfitUsdt;
    window.__socioBnTotalProfitUsdt = totalProfitUsdt;
    window.__socioBnTotalWithdrawnUsdt = totalWithdrawnUsdt;
    // Cacheado para el "pendiente histórico" por persona (pedido explícito
    // del usuario, sep 2026) -- ver socioBnStatsRefresh, tarjeta "Ganancia
    // neta a repartir". Se necesitan estos valores en CLP (no solo el
    // convertido a USDT de arriba) para descontar el % de PPM sobre TODO
    // el histórico, igual que ya se hace por rango de fechas.
    window.__socioBnTotalProfitClp = totalProfitClp;
    window.__socioBnTotalAvgSell = totalAvgSell;
    window.__socioBnTotalClpReceived = totalStats ? Number(totalStats.totalClpReceived || 0) : 0;
    window.__socioBnAllWithdrawals = withdrawalsRes.ok ? (withdrawalsRes.withdrawals || []) : [];

    socioBnRenderStats(res.stats, { initial, monthProfitUsdt, totalProfitUsdt, totalWithdrawnUsdt });
    window.__socioBnCapacityCache = res.stats.perCapacityBreakdown || [];
    socioBnRenderCapacityList();
    socioBnRenderSales(res.recentSales || []);
    socioBnRenderPager(res);
  }

  window.socioBnOpenCapitalModal = function(){
    const modal = document.getElementById('socioBnCapitalModalBackdrop');
    if(!modal) return;
    document.getElementById('socioBnCapitalInput').value = window.__socioBnInitialCapital || '';

    const listEl = document.getElementById('socioBnMonthlyHistoryList');
    if(listEl){
      const months = window.__socioBnMonthlyHistory || [];
      if(!months.length){
        listEl.innerHTML = `<div style="font-size:12px;color:#64748b;">Sin datos todavía</div>`;
      } else {
        listEl.innerHTML = months.map(m => {
          const avgSell = m.avgSalePrice ? Number(m.avgSalePrice) : 0;
          const profitClp = m.profitClp !== null && m.profitClp !== undefined ? Number(m.profitClp) : 0;
          const profitUsdt = avgSell > 0 ? profitClp / avgSell : 0;
          const sign = profitUsdt >= 0 ? '+' : '-';
          const color = profitUsdt >= 0 ? '#34d399' : '#fb7185';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(148,163,184,.08);font-size:13px;">
            <span style="color:#cbd5e1;font-weight:700;">${socioBnMonthLabel(m.month)}</span>
            <span style="color:${color};font-weight:900;">${sign}${socioBnMoney(Math.abs(profitUsdt), 2)} USDT</span>
          </div>`;
        }).join('');
      }
    }

    modal.classList.add('open');
  };

  window.socioBnCloseCapitalModal = function(){
    document.getElementById('socioBnCapitalModalBackdrop')?.classList.remove('open');
  };

  window.socioBnSaveInitialCapital = async function(){
    const raw = document.getElementById('socioBnCapitalInput')?.value;
    const value = Number(raw);
    if(!isFinite(value) || value < 0){
      if(typeof showToast === 'function') showToast('Ingresa un monto válido', 'error');
      return;
    }
    const res = await socioBnFetch('/api/partner/initial-capital', { method: 'POST', body: JSON.stringify({ value }) });
    if(res.ok){
      window.socioBnCloseCapitalModal();
      await socioBnLoadDashboard();
    } else if(typeof showToast === 'function'){
      showToast(res.error || 'Error al guardar', 'error');
    }
  };

  // Mismo estilo grande y de colores que "Resumen P2P" del dashboard ONZE
  // (.p2p-dashboard-card/-label/-value/-small) — colores puestos en línea
  // (no la clase .green) porque esas clases usan una variable CSS que solo
  // está definida dentro de #view-p2p-dashboard.
  function socioBnDashCard(label, value, opts){
    opts = opts || {};
    const cls = 'p2p-dashboard-card' + (opts.main ? ' main' : '');
    const clickAttrs = opts.onClick ? ` style="cursor:pointer;" onclick="${opts.onClick}" title="${opts.title || ''}"` : '';
    return `<div class="${cls}"${clickAttrs}>
      <div class="p2p-dashboard-label">${label}</div>
      <div class="p2p-dashboard-value" style="color:${opts.color || '#f8fafc'};">${value}</div>
      ${opts.sub ? `<div class="p2p-dashboard-small" style="${opts.subColor ? 'color:' + opts.subColor + ';' : ''}">${opts.sub}</div>` : ''}
    </div>`;
  }

  function socioBnRenderStats(stats, capital){
    const grid = document.getElementById('socioBnStatsGrid');
    if(!grid) return;
    const GREEN = '#34d399', RED = '#fb7185', WHITE = '#f8fafc';
    const profitUsdt = (stats.profitClp !== null && stats.weightedAvgBuyPrice) ? stats.profitClp / stats.weightedAvgBuyPrice : null;
    const profitColor = stats.profitClp === null ? WHITE : (stats.profitClp >= 0 ? GREEN : RED);
    const profitSign = stats.profitClp !== null && stats.profitClp >= 0 ? '+' : '';

    const cards = [];
    if(capital){
      const withdrawn = capital.totalWithdrawnUsdt || 0;
      const capTotal = capital.initial + capital.totalProfitUsdt - withdrawn;
      const capSign = capital.monthProfitUsdt >= 0 ? '+' : '-';
      cards.push(socioBnDashCard(
        'Capital P2P',
        socioBnMoney(capTotal, 2) + ' USDT',
        {
          main: true, color: GREEN,
          sub: `Inicial: <strong>${socioBnMoney(capital.initial, 2)} USDT</strong> · Este mes: ${capSign}${socioBnMoney(Math.abs(capital.monthProfitUsdt), 2)} USDT${withdrawn > 0 ? ` · Retirado: -${socioBnMoney(withdrawn, 2)} USDT` : ''}`,
          onClick: 'window.socioBnOpenCapitalModal()', title: 'Click para definir el capital inicial',
        }
      ));
    }
    cards.push(
      socioBnDashCard('Ventas completadas', String(stats.salesCount ?? 0), { color: WHITE }),
      socioBnDashCard('CLP recibido', socioBnMoney(stats.totalClpReceived, 0) + ' CLP', { color: GREEN }),
      socioBnDashCard('USDT vendido', socioBnMoney(stats.totalUsdtSold, 2) + ' USDT', { color: GREEN }),
      socioBnDashCard(
        'Ganancia',
        stats.profitClp !== null ? profitSign + socioBnMoney(stats.profitClp, 0) + ' CLP' : '—',
        { color: profitColor, sub: profitUsdt !== null ? profitSign + socioBnMoney(profitUsdt, 2) + ' USDT' : '', subColor: profitColor }
      ),
      socioBnDashCard('Ganancia %', stats.profitPct !== null ? socioBnMoney(stats.profitPct, 2) + '%' : '—', { color: profitColor }),
      // Pedido explícito del usuario (ago 2026): venta y compra juntas en la
      // misma tarjeta (antes eran 2 tarjetas separadas), cada una con su
      // propio color.
      socioBnDashCard(
        'Tasas promedio',
        '<span style="font-size:13px;">Tasa promedio venta: <strong style="color:' + GREEN + ';">' + (stats.avgSalePrice !== null ? socioBnMoney(stats.avgSalePrice, 2) + ' CLP' : '—') + '</strong></span>',
        { color: WHITE, sub: 'Tasa promedio compra: <strong style="color:#38bdf8;">' + (stats.weightedAvgBuyPrice !== null ? socioBnMoney(stats.weightedAvgBuyPrice, 2) + ' CLP' : '—') + '</strong>' }
      ),
      socioBnDashCard('Comisión Binance', socioBnMoney(stats.totalCommissionUsdt, 2) + ' USDT', { color: WHITE })
    );
    grid.innerHTML = cards.join('');
    if(Number(stats.unmatchedUsdt) > 0.01){
      grid.innerHTML += socioBnDashCard('USDT sin capacity', socioBnMoney(stats.unmatchedUsdt, 2) + ' USDT', { color: '#fbbf24' });
    }
  }

  function socioBnRenderPager(res){
    const pager = document.getElementById('socioBnSalesPager');
    if(!pager) return;
    if(!res.salesForDateCount){
      pager.innerHTML = '';
      return;
    }
    const prevDisabled = res.page <= 1 ? 'disabled style="opacity:.4;"' : '';
    const nextDisabled = res.page >= res.totalPages ? 'disabled style="opacity:.4;"' : '';
    pager.innerHTML = `
      <button class="btn secondary" type="button" style="padding:4px 10px;" ${prevDisabled} onclick="window.socioBnGoPage(${res.page - 1})">←</button>
      <span>Página ${res.page} de ${res.totalPages} (${res.salesForDateCount} venta${res.salesForDateCount === 1 ? '' : 's'})</span>
      <button class="btn secondary" type="button" style="padding:4px 10px;" ${nextDisabled} onclick="window.socioBnGoPage(${res.page + 1})">→</button>
    `;
  }

  // Mismo estilo de "tarjeta por venta" que ya se usa en Ventas Binance del
  // panel ONZE (renderP2PDashboardFromBinance) — orden/fecha/comisión a la
  // izquierda, precio/total a la derecha — en vez de una tabla plana.
  function socioBnRenderSales(sales){
    const wrap = document.getElementById('socioBnSalesTable');
    if(!wrap) return;
    if(!sales.length){
      wrap.innerHTML = '<div class="p2p-dashboard-empty">Sin ventas sincronizadas todavía.</div>';
      return;
    }
    wrap.innerHTML = sales.map(function(s){
      const date = s.executedAt ? new Date(s.executedAt).toLocaleString('es-CL', {
        timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '';
      const statusLabel = s.orderStatus === 'COMPLETED' ? 'Completada' : (s.orderStatus || '');
      const isManual = String(s.orderNumber || '').startsWith('manual_');
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;">
          <div>
            <strong style="color:#f8fafc;">Venta ${socioBnMoney(s.amount, 2)} USDT</strong>${isManual ? ' <span style="color:#fbbf24;font-size:11px;font-weight:900;">MANUAL</span>' : ''}
            <div style="color:#00d4ff;font-size:11px;margin-top:3px;font-family:monospace;word-break:break-all;">Orden: ${s.orderNumber || ''}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${date} · ${s.paymentMethod || 'Banco no disponible'}</div>
            <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">Comisión: ${socioBnMoney(s.commission, 2)} USDT</div>
          </div>
          <div style="text-align:right;">
            <strong style="color:#34d399;">${socioBnMoney(s.unitPrice, 2)} CLP</strong>
            <div style="color:#f8fafc;font-size:12px;margin-top:3px;">${socioBnMoney(s.totalPrice, 0)} CLP</div>
            <div style="color:#34d399;font-size:12px;margin-top:3px;">${statusLabel}</div>
            ${isManual ? `<button class="btn small danger" type="button" style="margin-top:4px;padding:2px 6px;font-size:12px;line-height:1;" onclick="window.socioBnDeleteManualSale('${s.orderNumber}')" title="Borrar venta manual">🗑️</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // Panel de estadísticas — pantalla aparte (modal) para consultar cualquier
  // día, rango de fechas, o el mes completo (default), sin afectar las
  // tarjetas "Hoy" de la pantalla principal. Usa /api/partner/dashboard con
  // from/to en vez de date.
  window.socioBnOpenStatsModal = function(){
    let modal = document.getElementById('socioBnStatsModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'socioBnStatsModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';

    const today = socioBnChileToday();
    const monthStart = today.slice(0, 7) + '-01';
    // El PPM se paga los primeros días del mes SIGUIENTE al que corresponde
    // (ej: el 5 de agosto se paga el PPM de julio) -- pedido explícito del
    // usuario (ago 2026): que el mes por defecto del selector sea el mes
    // ANTERIOR, no el actual.
    const prevMonthDate = new Date(today + 'T12:00:00');
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonth = prevMonthDate.toISOString().slice(0, 7);

    modal.innerHTML = `
      <div style="background:#071828;border:1px solid #1a3a5a;border-radius:16px;padding:24px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="color:#00d4ff;margin:0;">📊 Estadísticas</h3>
          <button onclick="document.getElementById('socioBnStatsModal').remove()"
            style="padding:8px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnStatsQuick('month')">Este mes</button>
          <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnStatsQuick('today')">Hoy</button>
          <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnStatsQuick('yesterday')">Ayer</button>
          <button class="btn secondary" type="button" style="padding:5px 10px;font-size:12px;" onclick="window.socioBnStatsQuick('7d')">Últimos 7 días</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Desde <input type="date" id="socioBnStatsFrom" value="${monthStart}" style="font-size:12px;" /></label>
          <label style="font-size:12px;color:#8aa0ba;display:flex;align-items:center;gap:4px;">Hasta <input type="date" id="socioBnStatsTo" value="${today}" style="font-size:12px;" /></label>
          <button class="btn" type="button" style="padding:5px 14px;font-size:12px;" onclick="window.socioBnStatsRefresh()">Ver</button>
        </div>
        <div class="p2p-dashboard-grid" id="socioBnStatsModalGrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));"></div>
        <details class="p2p-collapsible">
          <summary>Ganancia por día</summary>
          <div class="p2p-collapsible-body">
            <div id="socioBnStatsDaily"></div>
          </div>
        </details>

        <h4 style="font-size:12px;color:#64748b;margin:20px 0 8px;">💸 Retiros y gastos</h4>
        <div class="p2p-withdraw-card">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="p2p-withdraw-toggle">
              <button class="p2p-withdraw-toggle-btn retiro active" type="button" id="socioBnWithdrawKindRetiro" onclick="window.socioBnSetWithdrawKind('retiro')">💸 Retiro</button>
              <button class="p2p-withdraw-toggle-btn gasto" type="button" id="socioBnWithdrawKindGasto" onclick="window.socioBnSetWithdrawKind('gasto')">🧾 Gasto</button>
            </div>
            <div class="p2p-withdraw-ppm-btn" title="Completa el monto con el PPM calculado del mes elegido">
              📊 PPM <input type="month" id="socioBnPpmMonthInput" value="${prevMonth}">
              <button type="button" onclick="window.socioBnUseMonthPpm()">Usar</button>
            </div>
          </div>

          <div class="p2p-withdraw-fields">
            <div class="p2p-withdraw-field" id="socioBnWithdrawPersonWrap">
              <label>Quién retira</label>
              <select id="socioBnWithdrawPerson">
                <option value="Hector">Hector</option>
                <option value="Josber">Josber</option>
              </select>
            </div>
            <div class="p2p-withdraw-field" id="socioBnWithdrawConceptWrap" style="display:none;">
              <label>Concepto del gasto</label>
              <input id="socioBnWithdrawConcept" type="text" placeholder="Ej: PPM agosto">
            </div>
            <div class="p2p-withdraw-field">
              <label>Monto (USDT)</label>
              <input id="socioBnWithdrawAmount" type="number" step="0.01" min="0" placeholder="0.00">
            </div>
            <div class="p2p-withdraw-field">
              <label>Fecha</label>
              <input id="socioBnWithdrawDate" type="date" value="${today}">
            </div>
            <div class="p2p-withdraw-field" style="grid-column:1/-1;">
              <label>Nota (opcional)</label>
              <input id="socioBnWithdrawNote" type="text" placeholder="Detalle adicional...">
            </div>
          </div>

          <div class="p2p-withdraw-submit-row">
            <div class="p2p-withdraw-error" id="socioBnWithdrawError"></div>
            <button class="p2p-withdraw-submit-btn" type="button" id="socioBnWithdrawSubmitBtn" onclick="window.socioBnRegisterWithdrawal()">💸 Registrar retiro</button>
          </div>

          <div class="p2p-withdraw-list" id="socioBnWithdrawList"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // % de PPM se carga una vez al abrir (no cambia seguido) -- se cachea en
    // window.__socioBnPpmPct para no repetir el fetch en cada refresh de rango.
    socioBnFetch('/api/partner/ppm-config').then(function(r){
      window.__socioBnPpmPct = (r.ok && r.value !== null) ? Number(r.value) : null;
      window.socioBnStatsRefresh();
    });
    window.socioBnStatsRefresh();
  };

  // Pedido explícito del usuario (jul 2026): tarjeta que muestra el PPM
  // (Pago Provisional Mensual, SII) a pagar sobre el CLP recibido del
  // período seleccionado en el panel de estadísticas -- el % todavía no
  // está confirmado con la contadora, así que queda editable (click en la
  // tarjeta) y se guarda en PartnerAccount.ppmPct, null hasta definirlo.
  window.socioBnOpenPpmModal = function(){
    let modal = document.getElementById('socioBnPpmModal');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'socioBnPpmModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:1000002;display:flex;align-items:center;justify-content:center;padding:20px;';

    const current = window.__socioBnPpmPct;
    modal.innerHTML = `
      <div style="background:#0d2137;border:1px solid #2a4a6a;border-radius:16px;padding:24px;max-width:380px;width:100%;">
        <h3 style="color:#00d4ff;margin-bottom:8px;">% de PPM (SII)</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:16px;">Porcentaje a aplicar sobre el CLP recibido del período para estimar el PPM a pagar. Confírmalo con tu contadora.</p>
        <input id="socioBnPpmInput" type="number" step="0.01" min="0" max="100" placeholder="Ej: 0.5" value="${current !== null && current !== undefined ? current : ''}"
          style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(96,165,250,.30);background:rgba(15,43,78,.78);color:#f8fafc;padding:12px 14px;font-size:16px;font-weight:700;outline:none;margin-bottom:8px;">
        <p id="socioBnPpmError" style="color:#fca5a5;font-size:12px;min-height:16px;margin-bottom:8px;"></p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="document.getElementById('socioBnPpmModal').remove()"
            style="padding:10px 16px;background:#2a4a6a;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
          <button onclick="window.socioBnSavePpm()"
            style="padding:10px 16px;background:#00d4ff;color:#022c22;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(function(){ document.getElementById('socioBnPpmInput')?.focus(); }, 50);
  };

  window.socioBnSavePpm = async function(){
    const input = document.getElementById('socioBnPpmInput');
    const error = document.getElementById('socioBnPpmError');
    const value = Number(input?.value);
    if(!isFinite(value) || value < 0 || value > 100){
      if(error) error.textContent = 'Ingresa un % válido (0-100).';
      return;
    }
    const r = await socioBnFetch('/api/partner/ppm-config', { method: 'POST', body: JSON.stringify({ value }) });
    if(r.ok){
      window.__socioBnPpmPct = r.value;
      document.getElementById('socioBnPpmModal')?.remove();
      window.socioBnStatsRefresh();
      if(typeof showToast === 'function') showToast('% de PPM guardado');
    } else if(error){
      error.textContent = r.error || 'Error al guardar';
    }
  };

  window.socioBnStatsQuick = function(kind){
    const fromEl = document.getElementById('socioBnStatsFrom');
    const toEl = document.getElementById('socioBnStatsTo');
    if(!fromEl || !toEl) return;
    const today = socioBnChileToday();
    if(kind === 'month'){
      fromEl.value = today.slice(0, 7) + '-01';
      toEl.value = today;
    } else if(kind === 'today'){
      fromEl.value = today;
      toEl.value = today;
    } else if(kind === 'yesterday'){
      const y = new Date(today + 'T12:00:00');
      y.setDate(y.getDate() - 1);
      const ys = y.toISOString().slice(0, 10);
      fromEl.value = ys;
      toEl.value = ys;
    } else if(kind === '7d'){
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() - 6);
      fromEl.value = d.toISOString().slice(0, 10);
      toEl.value = today;
    }
    window.socioBnStatsRefresh();
  };

  window.socioBnStatsRefresh = async function(){
    const fromEl = document.getElementById('socioBnStatsFrom');
    const toEl = document.getElementById('socioBnStatsTo');
    if(!fromEl || !toEl) return;
    const params = new URLSearchParams({ from: fromEl.value, to: toEl.value || fromEl.value });
    const res = await socioBnFetch('/api/partner/dashboard?' + params.toString());
    if(!res.ok) return;

    // Reactivado (ago 2026): ahora que los retiros "mes de julio" quedaron
    // con su fecha real de julio (ya no 15-08), filtrar por withdrawnAt
    // dentro del rango seleccionado sí refleja correctamente qué retiro es
    // de "este mes". Ver nota en la tarjeta de reparto más abajo.
    const wResForSplit = await socioBnFetch('/api/partner/withdrawals?' + params.toString());
    window.__socioBnWithdrawalsInRange = (wResForSplit.ok && Array.isArray(wResForSplit.withdrawals)) ? wResForSplit.withdrawals : [];

    const grid = document.getElementById('socioBnStatsModalGrid');
    if(grid){
      const s = res.rangeStats;
      const GREEN = '#34d399', RED = '#fb7185', WHITE = '#f8fafc';
      const profitUsdt = (s.profitClp !== null && s.weightedAvgBuyPrice) ? s.profitClp / s.weightedAvgBuyPrice : null;
      const profitColor = s.profitClp === null ? WHITE : (s.profitClp >= 0 ? GREEN : RED);
      const profitSign = s.profitClp !== null && s.profitClp >= 0 ? '+' : '';
      grid.innerHTML = [
        socioBnDashCard('CLP recibido', socioBnMoney(s.totalClpReceived, 0) + ' CLP', { main: true, color: GREEN }),
        socioBnDashCard('USDT vendido', socioBnMoney(s.totalUsdtSold, 2) + ' USDT', { color: GREEN }),
        socioBnDashCard(
          'Ganancia (ya con comisión descontada)',
          s.profitClp !== null ? profitSign + socioBnMoney(s.profitClp, 0) + ' CLP' : '—',
          { color: profitColor, sub: profitUsdt !== null ? profitSign + socioBnMoney(profitUsdt, 2) + ' USDT' : '', subColor: profitColor }
        ),
        socioBnDashCard('Ganancia %', s.profitPct !== null ? socioBnMoney(s.profitPct, 2) + '%' : '—', { color: profitColor }),
        socioBnDashCard('Comisión Binance', socioBnMoney(s.totalCommissionUsdt, 2) + ' USDT', { color: WHITE }),
        // Pedido explícito del usuario (ago 2026): venta y compra juntas en
        // la misma tarjeta (antes eran 2 tarjetas separadas, y la de compra
        // se había sacado de este modal en jul 2026), cada una con su color.
        socioBnDashCard(
          'Tasas promedio',
          '<span style="font-size:13px;">Tasa promedio venta: <strong style="color:' + GREEN + ';">' + (s.avgSalePrice !== null ? socioBnMoney(s.avgSalePrice, 2) + ' CLP' : '—') + '</strong></span>',
          { color: WHITE, sub: 'Tasa promedio compra: <strong style="color:#38bdf8;">' + (s.weightedAvgBuyPrice !== null ? socioBnMoney(s.weightedAvgBuyPrice, 2) + ' CLP' : '—') + '</strong>' }
        ),
        (function(){
          // Pedido explícito del usuario (jul 2026): reemplaza "Tasa prom.
          // compra" en el panel de estadísticas -- mismo cálculo que la
          // tarjeta "Capital P2P" principal (inicial + ganancia acumulada de
          // TODO el histórico, "este mes" solo informativo), usando los
          // valores ya cacheados por socioBnLoadDashboard.
          const initial = window.__socioBnInitialCapital || 0;
          const totalProfitUsdt = window.__socioBnTotalProfitUsdt || 0;
          const monthProfitUsdt = window.__socioBnMonthProfitUsdt || 0;
          const withdrawn = window.__socioBnTotalWithdrawnUsdt || 0;
          const capTotal = initial + totalProfitUsdt - withdrawn;
          const sign = monthProfitUsdt >= 0 ? '+' : '-';
          return socioBnDashCard(
            'Capital P2P',
            socioBnMoney(capTotal, 2) + ' USDT',
            { color: GREEN, sub: `Inicial: ${socioBnMoney(initial, 2)} USDT · Este mes: ${sign}${socioBnMoney(Math.abs(monthProfitUsdt), 2)} USDT${withdrawn > 0 ? ` · Retirado: -${socioBnMoney(withdrawn, 2)} USDT` : ''}` }
          );
        })(),
        (function(){
          const pct = window.__socioBnPpmPct;
          const hasPct = pct !== null && pct !== undefined;
          const avgSell = s.avgSalePrice ? Number(s.avgSalePrice) : 0;
          const ppmClp = hasPct ? Number(s.totalClpReceived || 0) * (pct / 100) : null;
          const ppmUsdt = (hasPct && avgSell > 0) ? ppmClp / avgSell : null;
          return socioBnDashCard(
            'PPM a pagar (SII)',
            hasPct ? socioBnMoney(ppmClp, 0) + ' CLP' : 'Configura el %',
            {
              color: '#fbbf24',
              sub: hasPct
                ? `${ppmUsdt !== null ? socioBnMoney(ppmUsdt, 2) + ' USDT · ' : ''}${socioBnMoney(pct, 2)}% del CLP recibido — click para editar`
                : 'Click para definir el % (pendiente con tu contadora)',
              onClick: 'window.socioBnOpenPpmModal()', title: 'Click para editar el % de PPM',
            }
          );
        })(),
        (function(){
          // Pedido explícito del usuario (jul 2026): reparto 50/50 de la
          // ganancia del período YA descontado el PPM -- el capital inicial
          // nunca se toca, esto es solo sobre la ganancia. Fórmula confirmada
          // con un ejemplo real: ganancia del período - PPM = neto a
          // repartir; cada uno recibe la mitad. Depende de tener el % de PPM
          // configurado (misma tarjeta de arriba) -- sin eso no hay forma de
          // calcular el neto real. Tarjeta a medida (no socioBnDashCard) para
          // poder mostrar ganancia total + el desglose por persona (Hector /
          // Josber) con números más chicos, tal como pidió el usuario.
          const pct = window.__socioBnPpmPct;
          const hasPct = pct !== null && pct !== undefined;
          const avgSell = s.avgSalePrice ? Number(s.avgSalePrice) : 0;
          const ganancia = s.profitClp !== null && s.profitClp !== undefined ? Number(s.profitClp) : null;
          const ppmClp = (hasPct && ganancia !== null) ? Number(s.totalClpReceived || 0) * (pct / 100) : null;
          const netoClp = (hasPct && ganancia !== null) ? ganancia - ppmClp : null;
          const netoUsdt = (netoClp !== null && avgSell > 0) ? netoClp / avgSell : null;
          const perPersonClp = netoClp !== null ? netoClp / 2 : null;
          const perPersonUsdt = (perPersonClp !== null && avgSell > 0) ? perPersonClp / avgSell : null;
          const signN = netoClp !== null && netoClp >= 0 ? '+' : '';
          const colorN = netoClp === null ? WHITE : (netoClp >= 0 ? GREEN : RED);

          if(netoClp === null){
            return `<div class="p2p-dashboard-card">
              <div class="p2p-dashboard-label">Ganancia neta a repartir</div>
              <div class="p2p-dashboard-value" style="font-size:15px;color:${WHITE};">Configura el % de PPM en la tarjeta anterior</div>
            </div>`;
          }

          // Reactivado (ago 2026): se había revertido esto porque los
          // retiros "mes de julio" estaban fechados 15-08 (el día que se
          // registraron, no el mes que liquidan) y por eso se contaban mal
          // como "de este mes". Se corrigió la fecha de esos 2 registros a
          // julio directamente en la base de datos -- con eso, filtrar por
          // withdrawnAt dentro del rango ya funciona bien: solo cuenta el
          // "adelanto retiro agosto" de Hector, como corresponde.
          const rawWithdrawals = Array.isArray(window.__socioBnWithdrawalsInRange) ? window.__socioBnWithdrawalsInRange : [];
          const withdrawnByPerson = (name) => rawWithdrawals
            .filter(w => w.kind === 'retiro' && String(w.person || '').trim().toLowerCase() === name.toLowerCase())
            .reduce((sum, w) => sum + Number(w.amountUsdt || 0), 0);

          // Pendiente histórico por persona (pedido explícito del usuario,
          // sep 2026): lo mismo que arriba, pero calculado sobre TODO el
          // histórico en vez de solo el rango de fechas elegido -- así, si
          // un mes (ej. agosto) no se retira, no "desaparece": queda
          // sumado acá hasta que de verdad se retire.
          const pctAll = window.__socioBnPpmPct;
          const hasPctAll = pctAll !== null && pctAll !== undefined;
          const totalClpReceivedAll = window.__socioBnTotalClpReceived || 0;
          const totalProfitClpAll = window.__socioBnTotalProfitClp;
          const totalAvgSellAll = window.__socioBnTotalAvgSell || 0;
          const ppmClpAll = (hasPctAll && totalProfitClpAll !== null && totalProfitClpAll !== undefined) ? totalClpReceivedAll * (pctAll / 100) : null;
          const netoClpAll = ppmClpAll !== null ? totalProfitClpAll - ppmClpAll : null;
          const netoUsdtAll = (netoClpAll !== null && totalAvgSellAll > 0) ? netoClpAll / totalAvgSellAll : null;
          const perPersonUsdtAll = netoUsdtAll !== null ? netoUsdtAll / 2 : null;
          const allWithdrawals = Array.isArray(window.__socioBnAllWithdrawals) ? window.__socioBnAllWithdrawals : [];
          const allTimeWithdrawnByPerson = (name) => allWithdrawals
            .filter(w => w.kind === 'retiro' && String(w.person || '').trim().toLowerCase() === name.toLowerCase())
            .reduce((sum, w) => sum + Number(w.amountUsdt || 0), 0);

          // Pedido explícito del usuario (ago 2026): NO expandir la tarjeta
          // al hacer click -- abrir una pantalla aparte (modal), igual que
          // "Capital P2P". La fila queda corta (nombre + cantidad de
          // retiros a la izquierda, total a recibir a la derecha) y el
          // detalle se arma en window.p2pOpenPersonNetModal (definido en
          // otro <script>, lado ONZE -- función window.-scoped, compartida).
          // Pedido explícito del usuario (sep 2026): el retiro se resta del
          // TOTAL histórico (no solo del mes en curso) -- un retiro grande
          // hecho hoy perfectamente puede estar cubriendo plata de meses
          // anteriores sin retirar todavía, no solo la de este mes. Antes,
          // el número principal era SOLO el del rango de fechas elegido,
          // y se podía ver negativo si el retiro superaba la ganancia de
          // ESE rango en particular, aunque en total la persona siguiera
          // teniendo saldo pendiente a favor. Ahora el número principal de
          // la tarjeta es directamente el pendiente histórico (todo lo
          // ganado - todo lo retirado, desde siempre) -- la tarjeta queda
          // corta (nombre + ese número) y el detalle completo (ganancia
          // histórica y cada retiro con su fecha) se ve al hacer click.
          const personRow = (name) => {
            const allWithdrawalsOf = allWithdrawals.filter(w => w.kind === 'retiro' && String(w.person || '').trim().toLowerCase() === name.toLowerCase());
            const withdrawnAllTimeUsdt = allWithdrawalsOf.reduce((sum, w) => sum + Number(w.amountUsdt || 0), 0);
            const pendingAllTimeUsdt = perPersonUsdtAll !== null ? perPersonUsdtAll - withdrawnAllTimeUsdt : null;
            const pendingAllTimeClp = (pendingAllTimeUsdt !== null && totalAvgSellAll > 0) ? pendingAllTimeUsdt * totalAvgSellAll : null;
            const sign = pendingAllTimeUsdt !== null && pendingAllTimeUsdt >= 0 ? '+' : '';
            const color = pendingAllTimeUsdt === null ? WHITE : (pendingAllTimeUsdt >= 0 ? GREEN : RED);
            const countLabel = allWithdrawalsOf.length === 1 ? '1 retiro' : `${allWithdrawalsOf.length} retiros`;
            const gananciaSign = perPersonUsdtAll !== null && perPersonUsdtAll >= 0 ? '+' : '';
            const payload = {
              name, color, sign, gananciaSign,
              gananciaLabel: "Ganancia total (histórica)",
              emptyWithdrawalsLabel: "Sin retiros registrados.",
              ganancia: socioBnMoney(perPersonUsdtAll, 2),
              share: socioBnMoney(pendingAllTimeUsdt, 2),
              shareClp: socioBnMoney(pendingAllTimeClp, 0),
              withdrawals: allWithdrawalsOf.map(w => ({
                date: new Date(w.withdrawnAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
                note: w.note || '',
                amount: socioBnMoney(Number(w.amountUsdt), 2),
              })),
            };
            const payloadAttr = JSON.stringify(payload).replace(/'/g, '&#39;');
            return `
            <div style="cursor:pointer;padding:9px 10px;margin-top:8px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.4);transition:border-color .15s ease;" onmouseover="this.style.borderColor='rgba(148,163,184,.32)'" onmouseout="this.style.borderColor='rgba(148,163,184,.14)'" onclick="window.p2pOpenPersonNetModalFromEl(this)" data-detail='${payloadAttr}'>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <span style="color:#cbd5e1;font-weight:800;font-size:12.5px;">${name}${allWithdrawalsOf.length ? ` <span style="color:#64748b;font-weight:600;">(${countLabel})</span>` : ''}</span>
                <span style="color:${color};font-weight:800;font-size:12.5px;white-space:nowrap;">${sign}${socioBnMoney(pendingAllTimeUsdt, 2)} USDT ›</span>
              </div>
            </div>`;
          };

          return `<div class="p2p-dashboard-card">
            <div class="p2p-dashboard-label">Ganancia neta a repartir</div>
            <div style="font-size:16px;font-weight:900;color:${colorN};">
              ${signN}${socioBnMoney(netoUsdt, 2)} USDT <span style="color:#8aa0ba;font-weight:700;">· ${signN}${socioBnMoney(netoClp, 0)} CLP</span>
            </div>
            ${personRow('Hector')}
            ${personRow('Josber')}
          </div>`;
        })(),
      ].join('');
    }

    const daily = document.getElementById('socioBnStatsDaily');
    if(daily){
      const rows = res.dailyBreakdown || [];
      daily.innerHTML = rows.length ? rows.map(function(d){
        const profit = d.profitClp;
        const profitUsdtDay = (profit !== null && d.weightedAvgBuyPrice) ? profit / d.weightedAvgBuyPrice : null;
        const profitColor = profit === null ? '#8aa0ba' : (profit >= 0 ? '#34d399' : '#fb7185');
        const sign = profit !== null && profit >= 0 ? '+' : '';
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(148,163,184,.1);font-size:13px;">
          <span style="color:#f8fafc;">${d.date}</span>
          <span style="color:#8aa0ba;">${socioBnMoney(d.totalClpReceived,0)} CLP</span>
          <span style="color:${profitColor};text-align:right;">${profit !== null ? sign + socioBnMoney(profit,0) + ' CLP' : '—'}${profitUsdtDay !== null ? '<br><span style="font-size:11px;">' + sign + socioBnMoney(profitUsdtDay,2) + ' USDT</span>' : ''}</span>
        </div>`;
      }).join('') : '<div class="p2p-dashboard-empty">Sin ventas en este rango.</div>';
    }

    window.socioBnRenderWithdrawals(fromEl.value, toEl.value || fromEl.value);
  };

  // Pedido explícito del usuario (ago 2026): además del retiro (Hector /
  // Josber sacan plata), un segundo tipo "gasto" (ej: pago del PPM, un gasto
  // del negocio) -- mismo mecanismo, ambos restan al instante del "Capital
  // P2P" (ver socioBnLoadDashboard), solo cambia cómo se guardan/muestran.
  window.__socioBnWithdrawKind = 'retiro';
  window.socioBnSetWithdrawKind = function(kind){
    window.__socioBnWithdrawKind = kind === 'gasto' ? 'gasto' : 'retiro';
    const isGasto = window.__socioBnWithdrawKind === 'gasto';
    const btnRetiro = document.getElementById('socioBnWithdrawKindRetiro');
    const btnGasto = document.getElementById('socioBnWithdrawKindGasto');
    const personWrap = document.getElementById('socioBnWithdrawPersonWrap');
    const conceptWrap = document.getElementById('socioBnWithdrawConceptWrap');
    const submitBtn = document.getElementById('socioBnWithdrawSubmitBtn');
    if(btnRetiro) btnRetiro.classList.toggle('active', !isGasto);
    if(btnGasto) btnGasto.classList.toggle('active', isGasto);
    if(personWrap) personWrap.style.display = isGasto ? 'none' : '';
    if(conceptWrap) conceptWrap.style.display = isGasto ? '' : 'none';
    if(submitBtn) submitBtn.textContent = isGasto ? '🧾 Registrar gasto' : '💸 Registrar retiro';
  };

  // Autocompleta el formulario de arriba en modo "Gasto" con el PPM del mes
  // elegido en el selector de al lado -- pedido explícito del usuario (ago
  // 2026): el PPM se paga los primeros días del mes SIGUIENTE (ej: el 5 de
  // agosto se retira el PPM de julio), así que NO puede ser siempre "el mes
  // actual" -- calcula el rango de ese mes en vivo (mismo endpoint que usa
  // el panel de estadísticas para cualquier rango) y aplica el % de PPM ya
  // configurado en la tarjeta "PPM a pagar (SII)".
  window.socioBnUseMonthPpm = async function(){
    const monthInput = document.getElementById('socioBnPpmMonthInput');
    const month = monthInput?.value;
    if(!month){
      if(typeof showToast === 'function') showToast('Elige el mes del PPM a retirar', 'error');
      return;
    }
    const [ppmRes, rangeRes] = await Promise.all([
      socioBnFetch('/api/partner/ppm-config'),
      socioBnFetch('/api/partner/dashboard?' + new URLSearchParams({ from: month + '-01', to: month + '-31' }).toString()),
    ]);
    const pct = (ppmRes.ok && ppmRes.value !== null && ppmRes.value !== undefined) ? Number(ppmRes.value) : null;
    if(pct === null){
      if(typeof showToast === 'function') showToast('Configura primero el % de PPM (tarjeta de arriba)', 'error');
      return;
    }
    if(!rangeRes.ok || !rangeRes.rangeStats){
      if(typeof showToast === 'function') showToast('No se pudo calcular el PPM de ese mes', 'error');
      return;
    }
    const s = rangeRes.rangeStats;
    const avgSell = s.avgSalePrice ? Number(s.avgSalePrice) : 0;
    const clpReceived = Number(s.totalClpReceived || 0);
    const ppmUsdt = avgSell > 0 ? (clpReceived * (pct / 100)) / avgSell : 0;

    window.socioBnSetWithdrawKind('gasto');
    const conceptEl = document.getElementById('socioBnWithdrawConcept');
    const amountEl = document.getElementById('socioBnWithdrawAmount');
    const monthLabel = new Date(month + '-01T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    if(conceptEl) conceptEl.value = 'PPM ' + monthLabel;
    if(amountEl) amountEl.value = ppmUsdt.toFixed(2);
  };

  window.socioBnRegisterWithdrawal = async function(){
    const kind = window.__socioBnWithdrawKind === 'gasto' ? 'gasto' : 'retiro';
    const personEl = document.getElementById('socioBnWithdrawPerson');
    const conceptEl = document.getElementById('socioBnWithdrawConcept');
    const amountEl = document.getElementById('socioBnWithdrawAmount');
    const dateEl = document.getElementById('socioBnWithdrawDate');
    const noteEl = document.getElementById('socioBnWithdrawNote');
    const errorEl = document.getElementById('socioBnWithdrawError');
    if(errorEl) errorEl.textContent = '';

    const person = kind === 'gasto' ? (conceptEl?.value || '').trim() : (personEl?.value || 'Hector');
    if(kind === 'gasto' && !person){
      if(errorEl) errorEl.textContent = 'Ingresa el concepto del gasto (ej: PPM agosto).';
      return;
    }
    const amount = Number(amountEl?.value);
    if(!isFinite(amount) || amount <= 0){
      if(errorEl) errorEl.textContent = 'Ingresa un monto válido en USDT.';
      return;
    }
    const r = await socioBnFetch('/api/partner/withdrawals', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        person,
        amountUsdt: amount,
        withdrawnAt: dateEl?.value ? dateEl.value + 'T12:00:00.000Z' : undefined,
        note: noteEl?.value || undefined,
      }),
    });
    if(r.ok){
      if(amountEl) amountEl.value = '';
      if(noteEl) noteEl.value = '';
      if(conceptEl) conceptEl.value = '';
      window.socioBnStatsRefresh();
      if(typeof showToast === 'function') showToast(kind === 'gasto' ? 'Gasto registrado' : 'Retiro registrado');
    } else if(errorEl){
      errorEl.textContent = r.error || (kind === 'gasto' ? 'Error al registrar el gasto' : 'Error al registrar el retiro');
    }
  };

  window.socioBnDeleteWithdrawal = async function(id){
    const r = await socioBnFetch('/api/partner/withdrawals', { method: 'DELETE', body: JSON.stringify({ id }) });
    if(r.ok){
      window.socioBnStatsRefresh();
    } else if(typeof showToast === 'function'){
      showToast(r.error || 'Error al borrar', 'error');
    }
  };

  window.socioBnRenderWithdrawals = async function(from, to){
    const listEl = document.getElementById('socioBnWithdrawList');
    if(!listEl) return;
    const r = await socioBnFetch('/api/partner/withdrawals?' + new URLSearchParams({ from, to }).toString());
    const rows = r.ok ? (r.withdrawals || []) : [];
    if(!rows.length){
      listEl.innerHTML = '<div class="p2p-withdraw-empty">Sin retiros ni gastos registrados en este rango.</div>';
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
        <span class="p2p-withdraw-row-amount">-${socioBnMoney(w.amountUsdt, 2)} USDT</span>
        <button type="button" class="p2p-withdraw-del-btn" onclick="window.socioBnDeleteWithdrawal(${w.id})" title="Borrar">×</button>
      </div>`;
    }).join('');
  };

  // Auto-sync cada 15s — mismo patrón que initBinanceSalesSync() del
  // dashboard ONZE (setInterval + resync al volver a la pestaña). Corre
  // siempre en segundo plano, no depende de estar parado en la vista Socio.
  function initSocioBnAutoSync(){
    if(window.__socioBnAutoSyncStarted) return;
    window.__socioBnAutoSyncStarted = true;
    setInterval(function(){ window.socioBnSync(true); }, 15000);
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'visible') window.socioBnSync(true);
    });
  }

  function initSocioBn(){
    // Bug real confirmado en vivo (ago 2026, tenant de Hector): esto corría
    // SIEMPRE sin importar el tenant, así que el auto-sync de AKI Transfers
    // (cada 15s) seguía llamando a /api/partner/sync en la sesión de Hector,
    // que no tiene esas credenciales -- console llena de errores 400 en
    // loop, para siempre. addSocioBnNavButton() ya tenía esta guarda, pero
    // buildSocioBnView()/initSocioBnAutoSync() no.
    if(!window.HAS_ONZE_CORE_BUSINESS) return;
    buildSocioBnView();
    addSocioBnNavButton();
    initSocioBnAutoSync();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(initSocioBn, 500); });
  } else {
    setTimeout(initSocioBn, 500);
  }
})();
