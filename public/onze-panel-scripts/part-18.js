
(function(){
  "use strict";

  async function usdtFetch(url, opts){
    const res = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts||{}));
    return res.json();
  }

  function usdtMoney(n, decimals){
    decimals = decimals === undefined ? 0 : decimals;
    n = Number(n) || 0;
    return n.toLocaleString('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  /* ————— Notificaciones de compra USDT (solo admin) ————— */
  // Pedido explícito del usuario (ago 2026): saber apenas un cliente pide
  // comprar (para fondear Skipo a tiempo) y si cancela. Polling simple (el
  // panel no tiene websockets) cada 20s -- solo corre para super_admin_global.

  let usdtNotifLastMaxId = null; // null = todavía no se hizo el primer poll
  let usdtNotifPollTimer = null;

  function usdtNotifSoundGetEnabled(){
    try { return localStorage.getItem('onze_usdt_notif_sound') !== 'off'; } catch { return true; }
  }
  function usdtNotifSoundSetEnabled(on){
    try { localStorage.setItem('onze_usdt_notif_sound', on ? 'on' : 'off'); } catch {}
  }
  function usdtNotifApplySoundToggleUI(){
    const toggle = document.getElementById('usdtNotifSoundToggle');
    const slider = document.getElementById('usdtNotifSoundSlider');
    const knob = document.getElementById('usdtNotifSoundKnob');
    const on = usdtNotifSoundGetEnabled();
    if(toggle) toggle.checked = on;
    if(slider) slider.style.background = on ? '#34d399' : '#334155';
    if(knob) knob.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
  }

  // Beep corto generado con Web Audio API -- sin depender de ningún archivo
  // de sonido externo.
  function usdtNotifPlayBeep(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }

  function usdtNotifUpdateBadges(count){
    [['usdtNotifBadgeDesktop', 'usdtNotifBellDesktop'], ['usdtNotifBadgeMobile', 'usdtNotifBellMobile']].forEach(function(pair){
      const badge = document.getElementById(pair[0]);
      const bell = document.getElementById(pair[1]);
      if(bell) bell.style.display = 'inline-flex';
      if(badge){
        if(count > 0){ badge.style.display = 'block'; badge.textContent = count > 99 ? '99+' : String(count); }
        else badge.style.display = 'none';
      }
    });
  }

  function usdtNotifRenderList(notifications){
    const list = document.getElementById('usdtNotifList');
    const empty = document.getElementById('usdtNotifEmpty');
    if(!list) return;
    if(!notifications.length){
      list.innerHTML = '';
      if(empty) empty.style.display = 'block';
      return;
    }
    if(empty) empty.style.display = 'none';
    list.innerHTML = notifications.map(function(n){
      const when = new Date(n.createdAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
      if(n.type === 'purchase_cancelled'){
        return `<div style="border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.08);border-radius:10px;padding:10px 12px;">
          <div style="font-size:13px;color:#fca5a5;font-weight:700;">❌ ${n.clientName} canceló su compra</div>
          <div style="font-size:12px;color:#8aa0ba;margin-top:2px;">Pedía ${usdtMoney(n.requestedClp)} CLP · ${when}</div>
        </div>`;
      }
      if(n.type === 'wallet_added'){
        return `<div style="border:1px solid rgba(96,165,250,.25);background:rgba(96,165,250,.08);border-radius:10px;padding:10px 12px;">
          <div style="font-size:13px;color:#93c5fd;font-weight:700;">💼 ${n.clientName} agregó su wallet</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;">
            <span style="font-family:monospace;font-size:12px;color:#e2e8f0;word-break:break-all;">${escHtml(n.walletAddress || '')}</span>
            ${n.withdrawalNetwork ? `<span style="font-size:10px;font-weight:700;color:#93c5fd;border:1px solid rgba(96,165,250,.3);border-radius:999px;padding:1px 7px;">${escHtml(n.withdrawalNetwork)}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
            <div style="font-size:11px;color:#64748b;">${when}</div>
            <button type="button" onclick="copyText('${(n.walletAddress || '').replace(/'/g, "\\'")}')" style="padding:3px 9px;font-size:11px;border-radius:6px;border:1px solid rgba(96,165,250,.3);background:rgba(96,165,250,.12);color:#93c5fd;cursor:pointer;">Copiar dirección</button>
          </div>
        </div>`;
      }
      const skipoLine = n.skipoClpNeeded !== null
        ? `<div style="font-size:12px;color:#34d399;margin-top:2px;">Manda a Skipo: <strong>${usdtMoney(n.skipoClpNeeded)} CLP</strong></div>`
        : `<div style="font-size:11px;color:#64748b;margin-top:2px;">No se pudo calcular el monto para Skipo.</div>`;
      return `<div style="border:1px solid rgba(52,211,153,.2);background:rgba(52,211,153,.06);border-radius:10px;padding:10px 12px;">
        <div style="font-size:13px;color:#e2e8f0;font-weight:700;">🛒 ${n.clientName} pidió comprar ${usdtMoney(n.requestedClp)} CLP</div>
        ${skipoLine}
        <div style="font-size:11px;color:#64748b;margin-top:4px;">${when}</div>
      </div>`;
    }).join('');
  }

  async function usdtNotifPoll(){
    if(typeof isGlobalAdmin !== 'function' || !isGlobalAdmin()) return;
    try {
      const res = await usdtFetch('/api/admin/notifications');
      if(!res.ok) return;
      usdtNotifUpdateBadges(res.unreadCount || 0);
      window.__usdtNotifCache = res.notifications || [];

      const maxId = res.notifications.reduce(function(m, n){ return Math.max(m, n.id); }, 0);
      if(usdtNotifLastMaxId !== null && maxId > usdtNotifLastMaxId && usdtNotifSoundGetEnabled()){
        usdtNotifPlayBeep();
      }
      usdtNotifLastMaxId = maxId;

      const modal = document.getElementById('usdtNotifModal');
      if(modal && modal.classList.contains('open')) usdtNotifRenderList(window.__usdtNotifCache);
    } catch {}
  }

  window.usdtOpenNotifModal = async function(){
    const modal = document.getElementById('usdtNotifModal');
    if(!modal) return;
    usdtNotifApplySoundToggleUI();
    usdtNotifRenderList(window.__usdtNotifCache || []);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('noscroll');
    // Se marcan como leídas al abrir -- el admin ya las está viendo.
    usdtNotifUpdateBadges(0);
    await usdtFetch('/api/admin/notifications', { method: 'PATCH', body: JSON.stringify({ all: true }) }).catch(function(){});
  };

  function usdtCloseNotifModal(){
    const modal = document.getElementById('usdtNotifModal');
    if(!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('noscroll');
  }

  document.addEventListener('DOMContentLoaded', function(){
    const closeBtn = document.getElementById('usdtNotifModalCloseBtn');
    if(closeBtn) closeBtn.addEventListener('click', usdtCloseNotifModal);
    const soundToggle = document.getElementById('usdtNotifSoundToggle');
    if(soundToggle) soundToggle.addEventListener('change', function(){
      usdtNotifSoundSetEnabled(soundToggle.checked);
      usdtNotifApplySoundToggleUI();
    });
    if(typeof isGlobalAdmin === 'function' && isGlobalAdmin()){
      usdtNotifPoll();
      usdtNotifPollTimer = setInterval(usdtNotifPoll, 20000);
    }
  });

  function usdtStatusLabel(status){
    const map = {
      pending_kyc: 'KYC pendiente', pending_approval: 'En revisión',
      approved: 'Aprobado', rejected: 'Rechazado', suspended: 'Suspendido',
    };
    return map[status] || status;
  }
  function usdtStatusColor(status){
    if(status === 'approved') return '#34d399';
    if(status === 'rejected' || status === 'suspended') return '#fb7185';
    return '#fbbf24';
  }

  function buildUsdtClientsView(){
    if(document.getElementById('view-usdt-clients')) return;
    const section = document.createElement('section');
    section.className = 'view admin-only-view';
    section.id = 'view-usdt-clients';
    section.innerHTML = `
      <section class="section-card">
        <div class="section-top">
          <div>
            <h2 class="section-title" style="font-size:18px;">Clientes USDT al mayor</h2>
            <p class="section-text">Aprobación de clientes, límites de compra y tramos de margen.</p>
          </div>
        </div>

        <h3 class="section-title" style="font-size:15px;margin-top:18px;">Tramos de margen por monto (CLP)</h3>
        <div id="usdtTiersList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:24px;">
          <label style="font-size:11px;color:#8aa0ba;">Desde (CLP)
            <input id="usdtTierMin" type="number" min="0" style="display:block;width:130px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;margin-top:4px;">
          </label>
          <label style="font-size:11px;color:#8aa0ba;">Hasta (CLP, vacío = sin techo)
            <input id="usdtTierMax" type="number" min="0" style="display:block;width:150px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;margin-top:4px;">
          </label>
          <label style="font-size:11px;color:#8aa0ba;">Margen (%)
            <input id="usdtTierPct" type="number" min="0" step="0.01" style="display:block;width:100px;padding:6px 8px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;margin-top:4px;">
          </label>
          <button class="btn small" type="button" id="usdtTierSaveBtn" onclick="window.usdtSaveTier()">+ Agregar tramo</button>
          <button class="btn small ghost" type="button" id="usdtTierCancelBtn" style="display:none;" onclick="window.usdtCancelEditTier()">Cancelar</button>
        </div>
        <div id="usdtTierMsg" style="font-size:12px;margin-bottom:20px;"></div>

        <h3 class="section-title" style="font-size:15px;">Clientes</h3>
        <div id="usdtClientsList" style="display:flex;flex-direction:column;gap:8px;"></div>

        <h3 class="section-title" style="font-size:15px;margin-top:24px;">Solicitudes abiertas</h3>
        <p class="section-text" style="margin-bottom:10px;">Si el correo del banco nunca llega pero ya verificaste el pago tú mismo (ej. viendo la app del banco directo), puedes registrarlo acá a mano — se suma exactamente igual que una transferencia real ya confirmada.</p>
        <div id="usdtOpenIntentsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>

        <h3 class="section-title" style="font-size:15px;margin-top:24px;">Pagos por revisar</h3>
        <p class="section-text" style="margin-bottom:10px;">Transferencias detectadas que no se pudieron asociar solas a una compra (sin código de referencia, o solo una coincidencia de nombre) — no cuentan para habilitar "Comprar" hasta que las asocies acá.</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8aa0ba;">
            <input id="usdtReviewSelectAll" type="checkbox" onchange="window.usdtToggleSelectAllReview(this)">
            Seleccionar todos
          </label>
          <button class="btn small danger" type="button" onclick="window.usdtDiscardSelectedReview()">Descartar seleccionados</button>
        </div>
        <div id="usdtReviewList" style="display:flex;flex-direction:column;gap:8px;"></div>

        <h3 class="section-title" style="font-size:15px;margin-top:24px;">Compras realizadas</h3>
        <div id="usdtPurchaseHistoryList" style="display:flex;flex-direction:column;gap:8px;"></div>
      </section>

      <div id="usdtKycModalBackdrop" class="p2p-capacity-modal-backdrop">
        <div class="p2p-capacity-modal" style="max-width:640px;max-height:85vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
            <h3 class="section-title" style="margin-bottom:4px;">Detalle KYC</h3>
            <button class="btn secondary" type="button" onclick="window.usdtCloseKycModal()">Cerrar</button>
          </div>
          <div id="usdtKycModalBody" style="font-size:13px;color:#c4cdd8;line-height:1.7;"></div>
        </div>
      </div>

      <div id="usdtWithdrawAddrModalBackdrop" class="p2p-capacity-modal-backdrop">
        <div class="p2p-capacity-modal" style="max-width:520px;max-height:85vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
            <h3 class="section-title" style="margin-bottom:4px;">Direcciones de retiro — <span id="usdtWithdrawAddrClientName"></span></h3>
            <button class="btn secondary" type="button" onclick="window.usdtCloseWithdrawAddrModal()">Cerrar</button>
          </div>
          <p class="section-text" style="margin-bottom:14px;">
            El cliente solo puede retirar a direcciones que agregues acá. Cada una debe corresponder a un contacto ya whitelisteado del lado del proveedor (elige de la lista, no escribas el id a mano).
          </p>

          <div style="background:rgba(0,0,0,.2);border:1px solid rgba(148,163,184,.08);border-radius:8px;padding:12px;margin-bottom:16px;">
            <label style="font-size:11px;color:#8aa0ba;display:block;margin-bottom:4px;">Contacto del proveedor</label>
            <select id="usdtWithdrawAddrContactSelect" style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.7);color:#e2e8f0;font-size:13px;margin-bottom:10px;" onchange="window.usdtOnWithdrawAddrContactChange()">
              <option value="">Cargando contactos...</option>
            </select>
            <label style="font-size:11px;color:#8aa0ba;display:block;margin-bottom:4px;">Alias (lo ve el cliente)</label>
            <input id="usdtWithdrawAddrAlias" type="text" placeholder="Ej: Mi billetera principal" style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.7);color:#e2e8f0;font-size:13px;margin-bottom:10px;">
            <div id="usdtWithdrawAddrPreview" style="font-size:11px;color:#64748b;margin-bottom:10px;"></div>
            <button class="btn small" type="button" onclick="window.usdtAddWithdrawAddr()">+ Agregar dirección</button>
            <div id="usdtWithdrawAddrMsg" style="font-size:12px;margin-top:6px;"></div>
          </div>

          <div id="usdtWithdrawAddrList" style="display:flex;flex-direction:column;gap:6px;"></div>
        </div>
      </div>
    `;
    document.querySelector('main')?.appendChild(section);
  }

  function addUsdtClientsNavButton(){
    // Pedido explícito del usuario (ago 2026): Clientes USDT es una línea
    // de negocio de ONZE, no del bot P2P vendible -- nunca se crea el
    // botón para un tenant sin negocio ONZE (evita la carrera con
    // applyTenantFeatureFlags, que corre ANTES de que este botón exista).
    if(!window.HAS_ONZE_CORE_BUSINESS) return;
    const btn = document.querySelector('[data-view-target="usdt-clients"]')
      || (() => {
        const target = document.querySelector('[data-view-target="socio-bn"]')
          || document.querySelector('[data-view-target="p2p-bot"]');
        if(!target || !target.parentNode) return null;
        const b = document.createElement('button');
        b.className = 'nav-btn admin-only-control';
        b.type = 'button';
        b.dataset.viewTarget = 'usdt-clients';
        b.textContent = 'Clientes USDT';
        target.parentNode.insertBefore(b, target.nextSibling);
        return b;
      })();
    if(!btn) return;
    btn.addEventListener('click', function(){
      if(typeof switchView === 'function') switchView('usdt-clients');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.usdtRefreshAll();
    });
  }

  window.usdtRefreshAll = async function(){
    await window.usdtLoadTiers();
    await window.usdtLoadClients();
    await window.usdtLoadReviewQueue();
    await window.usdtLoadPurchaseHistory();
  };

  /* ————— Tramos de margen ————— */

  window.usdtLoadTiers = async function(){
    const res = await usdtFetch('/api/admin/usdt-margin-tiers');
    const list = document.getElementById('usdtTiersList');
    if(!list) return;
    if(!res.ok || !res.tiers?.length){
      list.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin tramos configurados — se usa un margen fijo por defecto hasta que agregues alguno.</div>';
      return;
    }
    list.innerHTML = res.tiers.map(function(t){
      const rango = t.maxClp === null
        ? usdtMoney(t.minClp) + ' CLP en adelante'
        : usdtMoney(t.minClp) + ' – ' + usdtMoney(t.maxClp) + ' CLP';
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:8px;padding:8px 12px;font-size:13px;">
        <span>${rango}</span>
        <span style="display:flex;align-items:center;gap:10px;">
          <strong style="color:#34d399;">${t.marginPct}%</strong>
          <button class="btn small secondary" type="button" style="padding:2px 8px;font-size:11px;" onclick='window.usdtEditTier(${JSON.stringify(t)})'>Editar</button>
          <button class="btn small danger" type="button" style="padding:2px 8px;font-size:11px;" onclick="window.usdtDeleteTier(${t.id})">Eliminar</button>
        </span>
      </div>`;
    }).join('');
  };

  window.__usdtEditingTierId = null;

  window.usdtEditTier = function(tier){
    window.__usdtEditingTierId = tier.id;
    document.getElementById('usdtTierMin').value = tier.minClp;
    document.getElementById('usdtTierMax').value = tier.maxClp ?? '';
    document.getElementById('usdtTierPct').value = tier.marginPct;
    document.getElementById('usdtTierSaveBtn').textContent = 'Guardar cambios';
    document.getElementById('usdtTierCancelBtn').style.display = '';
  };

  window.usdtCancelEditTier = function(){
    window.__usdtEditingTierId = null;
    document.getElementById('usdtTierMin').value = '';
    document.getElementById('usdtTierMax').value = '';
    document.getElementById('usdtTierPct').value = '';
    document.getElementById('usdtTierSaveBtn').textContent = '+ Agregar tramo';
    document.getElementById('usdtTierCancelBtn').style.display = 'none';
    document.getElementById('usdtTierMsg').textContent = '';
  };

  window.usdtSaveTier = async function(){
    const msg = document.getElementById('usdtTierMsg');
    const minClp = document.getElementById('usdtTierMin').value;
    const maxClpRaw = document.getElementById('usdtTierMax').value;
    const marginPct = document.getElementById('usdtTierPct').value;
    const payload = { minClp: Number(minClp), maxClp: maxClpRaw === '' ? null : Number(maxClpRaw), marginPct: Number(marginPct) };
    const editingId = window.__usdtEditingTierId;
    const res = await usdtFetch('/api/admin/usdt-margin-tiers', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
    });
    if(!res.ok){ msg.textContent = res.error || 'No se pudo guardar'; msg.style.color = '#fb7185'; return; }
    window.usdtCancelEditTier();
    window.usdtLoadTiers();
  };

  window.usdtDeleteTier = async function(id){
    if(!(await onzeConfirm('¿Eliminar este tramo de margen?'))) return;
    await usdtFetch('/api/admin/usdt-margin-tiers?id=' + id, { method: 'DELETE' });
    if(window.__usdtEditingTierId === id) window.usdtCancelEditTier();
    window.usdtLoadTiers();
  };

  /* ————— Clientes ————— */

  window.__usdtClientsCache = [];

  function usdtRenderClientCard(c){
    const date = new Date(c.createdAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    const nameEsc = (c.fullName||'').replace(/'/g,"\\'");
    return `<div style="background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <strong style="color:#fff;">${c.fullName}</strong>
          <span style="background:rgba(0,0,0,.3);color:${usdtStatusColor(c.status)};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:8px;">${usdtStatusLabel(c.status)}</span>
          <div style="color:#8aa0ba;font-size:12px;margin-top:3px;">${c.email} · Registrado ${date}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn secondary" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtOpenKycModal(${c.id})">Ver KYC</button>
          <button class="btn secondary" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtOpenWithdrawAddrModal(${c.id},'${nameEsc}')">🔑 Direcciones de retiro</button>
          ${c.status !== 'approved' ? `<button class="btn small" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtSetStatus(${c.id},'approved')">Aprobar</button>` : ''}
          ${c.status !== 'rejected' && c.status !== 'approved' ? `<button class="btn small danger" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtSetStatus(${c.id},'rejected')">Rechazar</button>` : ''}
          ${c.status === 'approved' ? `<button class="btn small danger" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtSetStatus(${c.id},'suspended')">Suspender</button>` : ''}
          ${c.status === 'rejected' ? `<button class="btn small danger" type="button" style="padding:4px 10px;font-size:12px;" onclick="window.usdtDeleteClient(${c.id})">🗑️ Eliminar</button>` : ''}
        </div>
      </div>
      <div style="margin-top:10px;background:rgba(0,0,0,.2);border:1px solid rgba(148,163,184,.08);border-radius:8px;padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:#8aa0ba;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">⚙️ Configuración de compra</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:end;">
          <label style="font-size:12px;color:#c4cdd8;">
            <div style="margin-bottom:3px;">Límite de compra</div>
            <div style="position:relative;">
              <input id="usdtLimit_${c.id}" type="text" inputmode="numeric" value="${c.purchaseLimitClp ? Number(c.purchaseLimitClp).toLocaleString('es-CL') : ''}" placeholder="Sin límite" oninput="window.usdtFormatClpInput(this)" style="width:150px;padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.7);color:#e2e8f0;font-size:13px;">
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:2px;">CLP</div>
          </label>
          <label style="font-size:12px;color:#c4cdd8;">
            <div style="margin-bottom:3px;">Margen fijo</div>
            <input id="usdtMargin_${c.id}" type="number" min="0" step="0.01" value="${c.fixedMarginPct ?? ''}" placeholder="Usa tramos" style="width:110px;padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.7);color:#e2e8f0;font-size:13px;">
            <div style="font-size:10px;color:#64748b;margin-top:2px;">% — vacío = tramos generales</div>
          </label>
          <button class="btn small secondary" type="button" onclick="window.usdtSaveClientSettings(${c.id})">Guardar</button>
        </div>
      </div>
    </div>`;
  }

  // Secciones por estado -- pedido explícito del usuario (ago 2026): los
  // clientes suspendidos y los activos (aprobados) deben verse en su propia
  // sección, no todos mezclados en una sola lista.
  const USDT_CLIENT_SECTIONS = [
    { key: 'pending', label: 'Pendientes de aprobación', match: s => s === 'pending_kyc' || s === 'pending_approval' },
    { key: 'approved', label: 'Activos', match: s => s === 'approved' },
    { key: 'suspended', label: 'Suspendidos', match: s => s === 'suspended' },
    { key: 'rejected', label: 'Rechazados', match: s => s === 'rejected' },
  ];

  window.usdtLoadClients = async function(){
    const res = await usdtFetch('/api/admin/usdt-clients');
    const list = document.getElementById('usdtClientsList');
    if(!list) return;
    if(!res.ok){ list.innerHTML = '<div style="color:#fb7185;font-size:12px;">' + (res.error||'Error al cargar') + '</div>'; return; }
    window.__usdtClientsCache = res.clients || [];
    if(!window.__usdtClientsCache.length){
      list.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin clientes registrados todavía.</div>';
      return;
    }
    list.innerHTML = USDT_CLIENT_SECTIONS.map(function(section){
      const clients = window.__usdtClientsCache.filter(c => section.match(c.status));
      if(!clients.length) return '';
      return `<div style="margin-bottom:18px;">
        <div style="font-size:11px;font-weight:700;color:#8aa0ba;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">${section.label} (${clients.length})</div>
        <div style="display:flex;flex-direction:column;gap:8px;">${clients.map(usdtRenderClientCard).join('')}</div>
      </div>`;
    }).join('');
  };

  window.usdtDeleteClient = async function(clientId){
    if(!(await onzeConfirm('¿Eliminar permanentemente este cliente rechazado? Esta acción no se puede deshacer.', { danger: true, confirmText: 'Eliminar' }))) return;
    const res = await usdtFetch('/api/admin/usdt-clients?id=' + clientId, { method: 'DELETE' });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo eliminar'); return; }
    window.usdtLoadClients();
  };

  window.usdtSetStatus = async function(clientId, status){
    const res = await usdtFetch('/api/admin/usdt-clients', { method: 'PATCH', body: JSON.stringify({ clientId, status }) });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo actualizar'); return; }
    window.usdtLoadClients();
  };

  window.usdtFormatClpInput = function(el){
    const digits = el.value.replace(/\D/g, '');
    el.value = digits ? Number(digits).toLocaleString('es-CL') : '';
  };

  window.usdtSaveClientSettings = async function(clientId){
    const limitDigits = document.getElementById('usdtLimit_' + clientId).value.replace(/\D/g, '');
    const marginRaw = document.getElementById('usdtMargin_' + clientId).value;
    const res = await usdtFetch('/api/admin/usdt-clients', {
      method: 'PATCH',
      body: JSON.stringify({
        clientId,
        purchaseLimitClp: limitDigits === '' ? null : Number(limitDigits),
        fixedMarginPct: marginRaw === '' ? null : Number(marginRaw),
      }),
    });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo guardar'); return; }
    window.usdtLoadClients();
  };

  window.usdtOpenKycModal = function(clientId){
    const client = window.__usdtClientsCache.find(c => c.id === clientId);
    const backdrop = document.getElementById('usdtKycModalBackdrop');
    const body = document.getElementById('usdtKycModalBody');
    if(!client || !backdrop || !body) return;
    const k = client.kycData || {};
    const rows = [
      ['RUT', k.rut], ['Nacionalidad', k.nacionalidad], ['Profesión', k.profesion],
      ['Actividad / Giro', k.actividadGiro], ['Domicilio', k.domicilio], ['Teléfono', k.telefono],
      ['Banco', k.nombreBanco], ['Tipo de cuenta', k.tipoCuenta], ['Número de cuenta', k.numeroCuenta],
      ['Monto mensual esperado', k.montoMensualEsperado],
      ['Productos a operar', Array.isArray(k.productosOperar) ? k.productosOperar.join(', ') : ''],
      ['¿Dinero propio?', k.dineroEsPropio ? 'Sí' : 'No'],
      ['Origen de los fondos', k.origenFondos],
      ['Declaración PEP', k.declaracionPep],
      ['Declaración US Person', k.declaracionUsPerson],
      ['Acepta términos', k.aceptaTerminos ? 'Sí' : 'No'],
    ];
    let html = rows.map(([label, value]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08);"><span style="color:#8aa0ba;">${label}</span><span style="text-align:right;color:#e2e8f0;">${value ?? '—'}</span></div>`).join('');
    if(k.duenoReal){
      html += `<div style="margin-top:10px;font-weight:700;color:#fbbf24;">Dueño real de los fondos</div>`;
      html += ['nombre','rut','nacionalidad','actividad','domicilio','telefono'].map(f => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08);"><span style="color:#8aa0ba;">${f}</span><span style="color:#e2e8f0;">${k.duenoReal[f] ?? '—'}</span></div>`).join('');
    }
    html += `<div style="margin-top:14px;"><div style="color:#8aa0ba;margin-bottom:6px;">Selfie con documento de identidad</div><img src="/api/admin/usdt-clients/${clientId}/selfie" style="max-width:100%;border-radius:10px;border:1px solid rgba(148,163,184,.15);" onerror="this.replaceWith(document.createTextNode('No se pudo cargar la imagen'))"></div>`;
    body.innerHTML = html;
    backdrop.classList.add('open');
  };

  window.usdtCloseKycModal = function(){
    document.getElementById('usdtKycModalBackdrop')?.classList.remove('open');
  };

  /* ————— Direcciones de retiro (Activos Digitales) ————— */
  // El cliente solo puede retirar a direcciones que el admin precargue acá
  // -- cada una ligada a un contacto YA whitelisteado del lado del
  // proveedor (elegido de una lista real, nunca tipeado a mano en un campo
  // que mueve dinero real). Ver app/api/admin/usdt-withdrawal-addresses y
  // app/api/admin/skipo-contacts.

  window.__usdtWithdrawAddrClientId = null;
  window.__usdtSkipoContactsCache = [];

  window.usdtOpenWithdrawAddrModal = async function(clientId, clientName){
    window.__usdtWithdrawAddrClientId = clientId;
    document.getElementById('usdtWithdrawAddrClientName').textContent = clientName || '';
    document.getElementById('usdtWithdrawAddrAlias').value = '';
    document.getElementById('usdtWithdrawAddrMsg').textContent = '';
    document.getElementById('usdtWithdrawAddrModalBackdrop')?.classList.add('open');

    const select = document.getElementById('usdtWithdrawAddrContactSelect');
    select.innerHTML = '<option value="">Cargando contactos...</option>';

    const [contactsRes, addrRes] = await Promise.all([
      usdtFetch('/api/admin/skipo-contacts'),
      usdtFetch('/api/admin/usdt-withdrawal-addresses?clientId=' + clientId),
    ]);

    if(contactsRes.ok){
      // Solo contactos de tipo cripto tienen sentido para retiros de USDT.
      window.__usdtSkipoContactsCache = (contactsRes.contacts || []).filter(c => c.type === 'EXTERNAL_CRYPTO' && c.crypto);
      if(!window.__usdtSkipoContactsCache.length){
        select.innerHTML = '<option value="">Sin contactos cripto disponibles</option>';
      } else {
        select.innerHTML = '<option value="">Elige un contacto...</option>' +
          window.__usdtSkipoContactsCache.map(c => `<option value="${c.id}">${c.alias} — ${c.crypto.assetSymbol}/${c.crypto.networkSymbol}</option>`).join('');
      }
    } else {
      select.innerHTML = '<option value="">Error al cargar</option>';
    }
    window.usdtOnWithdrawAddrContactChange();
    window.usdtRenderWithdrawAddrList(addrRes.ok ? (addrRes.addresses || []) : []);
  };

  window.usdtCloseWithdrawAddrModal = function(){
    document.getElementById('usdtWithdrawAddrModalBackdrop')?.classList.remove('open');
  };

  window.usdtOnWithdrawAddrContactChange = function(){
    const select = document.getElementById('usdtWithdrawAddrContactSelect');
    const preview = document.getElementById('usdtWithdrawAddrPreview');
    const contact = window.__usdtSkipoContactsCache.find(c => c.id === select.value);
    if(!contact){ preview.textContent = ''; return; }
    preview.textContent = `${contact.crypto.assetSymbol} en ${contact.crypto.networkSymbol} — ${contact.crypto.address}`;
  };

  window.usdtAddWithdrawAddr = async function(){
    const clientId = window.__usdtWithdrawAddrClientId;
    const select = document.getElementById('usdtWithdrawAddrContactSelect');
    const alias = document.getElementById('usdtWithdrawAddrAlias').value.trim();
    const msg = document.getElementById('usdtWithdrawAddrMsg');
    const contact = window.__usdtSkipoContactsCache.find(c => c.id === select.value);

    if(!contact){ msg.style.color = '#fb7185'; msg.textContent = 'Elige un contacto'; return; }
    if(!alias){ msg.style.color = '#fb7185'; msg.textContent = 'Ingresa un alias'; return; }

    const res = await usdtFetch('/api/admin/usdt-withdrawal-addresses', {
      method: 'POST',
      body: JSON.stringify({
        clientId, alias,
        assetSymbol: contact.crypto.assetSymbol,
        networkSymbol: contact.crypto.networkSymbol,
        address: contact.crypto.address,
        providerContactId: contact.id,
      }),
    });
    if(!res.ok){ msg.style.color = '#fb7185'; msg.textContent = res.error || 'No se pudo agregar'; return; }
    msg.style.color = '#34d399';
    msg.textContent = 'Agregada';
    document.getElementById('usdtWithdrawAddrAlias').value = '';
    const addrRes = await usdtFetch('/api/admin/usdt-withdrawal-addresses?clientId=' + clientId);
    window.usdtRenderWithdrawAddrList(addrRes.ok ? (addrRes.addresses || []) : []);
  };

  window.usdtRenderWithdrawAddrList = function(addresses){
    const list = document.getElementById('usdtWithdrawAddrList');
    if(!addresses.length){
      list.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin direcciones precargadas todavía.</div>';
      return;
    }
    list.innerHTML = addresses.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:8px;padding:8px 10px;">
        <div>
          <strong style="color:#fff;font-size:13px;">${a.alias}</strong>
          <div style="color:#8aa0ba;font-size:11px;margin-top:2px;">${a.assetSymbol}/${a.networkSymbol} — ${a.address}</div>
        </div>
        <button class="btn small danger" type="button" onclick="window.usdtDeleteWithdrawAddr(${a.id})">Quitar</button>
      </div>
    `).join('');
  };

  window.usdtDeleteWithdrawAddr = async function(id){
    if(!(await onzeConfirm('¿Quitar esta dirección? El cliente ya no podrá elegirla para retirar.'))) return;
    await usdtFetch('/api/admin/usdt-withdrawal-addresses?id=' + id, { method: 'DELETE' });
    const addrRes = await usdtFetch('/api/admin/usdt-withdrawal-addresses?clientId=' + window.__usdtWithdrawAddrClientId);
    window.usdtRenderWithdrawAddrList(addrRes.ok ? (addrRes.addresses || []) : []);
  };

  /* ————— Revisión de pagos (Activos Digitales) ————— */

  window.__usdtOpenIntentsCache = [];

  window.usdtLoadReviewQueue = async function(){
    const res = await usdtFetch('/api/admin/usdt-payment-review');
    const list = document.getElementById('usdtReviewList');
    const openList = document.getElementById('usdtOpenIntentsList');
    if(!list) return;
    if(!res.ok){ list.innerHTML = '<div style="color:#fb7185;font-size:12px;">' + (res.error||'Error al cargar') + '</div>'; return; }
    window.__usdtOpenIntentsCache = res.openIntents || [];

    if(openList){
      if(!window.__usdtOpenIntentsCache.length){
        openList.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin solicitudes abiertas.</div>';
      }else{
        openList.innerHTML = window.__usdtOpenIntentsCache.map(function(i){
          const remaining = Number(i.requestedClp) - Number(i.receivedClp || 0);
          return `<div style="background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:12px 14px;">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;">
              <div>
                <strong style="color:#fff;">${i.referenceCode}</strong>
                <span style="color:#8aa0ba;font-size:12px;"> — ${i.client?.fullName || ''} — pide ${usdtMoney(i.requestedClp)} CLP, lleva ${usdtMoney(i.receivedClp)} CLP</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="color:#8aa0ba;font-size:12px;">¿Llegó el pago de <strong style="color:#e2e8f0;">${usdtMoney(remaining)} CLP</strong>?</span>
                <button type="button" title="Sí, llegó completo" onclick="window.usdtRegisterManualPayment(${i.id})"
                  style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.14);color:#34d399;font-size:16px;font-weight:700;cursor:pointer;">✓</button>
                <button type="button" title="No, todavía no" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:#fca5a5;font-size:16px;font-weight:700;cursor:pointer;">✗</button>
              </div>
            </div>
          </div>`;
        }).join('');
      }
    }

    const selectAll = document.getElementById('usdtReviewSelectAll');
    if(selectAll) selectAll.checked = false;
    if(!res.transfers?.length){
      list.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin pagos pendientes de revisión.</div>';
      return;
    }
    const intentOptions = window.__usdtOpenIntentsCache.map(function(i){
      return `<option value="${i.id}">${i.referenceCode} — ${i.client?.fullName || ''} — ${usdtMoney(i.requestedClp)} CLP</option>`;
    }).join('');
    list.innerHTML = res.transfers.map(function(t){
      const date = new Date(t.receivedAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
      const suggestion = t.purchaseIntent
        ? `<div style="color:#fbbf24;font-size:12px;margin-top:4px;">Sugerido por nombre: ${t.purchaseIntent.client?.fullName || ''} (${t.purchaseIntent.referenceCode})</div>`
        : '';
      const authBadge = t.authPassed
        ? `<span style="color:#34d399;font-size:11px;">✓ correo verificado</span>`
        : `<span style="color:#fb7185;font-size:11px;">⚠ no se pudo verificar el remitente</span>`;
      return `<div style="background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" class="usdtReviewCheckbox" data-transfer-id="${t.id}">
            <strong style="color:#fff;">${usdtMoney(t.amountClp)} CLP</strong>
            <span style="color:#8aa0ba;font-size:12px;">de ${t.payerName || '(sin nombre)'} · ${date}</span>
          </div>
          ${authBadge}
        </div>
        ${t.rawComment ? `<div style="color:#8aa0ba;font-size:12px;margin-top:4px;">Comentario: "${t.rawComment}"</div>` : ''}
        ${suggestion}
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <select id="usdtReviewSelect_${t.id}" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.7);color:#e2e8f0;font-size:12px;">
            <option value="">Asociar a…</option>
            ${intentOptions}
          </select>
          <button class="btn small" type="button" onclick="window.usdtConfirmReview(${t.id})">Asociar</button>
          <button class="btn small danger" type="button" onclick="window.usdtDiscardReview(${t.id})">Descartar (no es de aquí)</button>
        </div>
      </div>`;
    }).join('');
    // Preselecciona la sugerencia por nombre, si hay una.
    res.transfers.forEach(function(t){
      if(t.purchaseIntent){
        const sel = document.getElementById('usdtReviewSelect_' + t.id);
        if(sel) sel.value = String(t.purchaseIntent.id);
      }
    });
  };

  // Check = confirma el monto PENDIENTE completo (requestedClp - receivedClp)
  // automáticamente, sin escribir nada -- pedido explícito del usuario (ago
  // 2026). La X no hace nada (a propósito): es solo la opción de "todavía
  // no", no registra ni cambia nada.
  window.usdtRegisterManualPayment = async function(purchaseIntentId){
    const intent = window.__usdtOpenIntentsCache.find(function(i){ return i.id === purchaseIntentId; });
    if(!intent) return;
    const amountClp = Number(intent.requestedClp) - Number(intent.receivedClp || 0);
    if(!(amountClp > 0)) return;
    if(!(await onzeConfirm(`¿Confirmas que YA viste el pago de ${usdtMoney(amountClp)} CLP entrando a la cuenta? Esto habilita la compra sin depender de ningún correo.`, { confirmText: 'Sí, lo recibí' }))) return;
    const res = await usdtFetch('/api/admin/usdt-payment-review', { method: 'PATCH', body: JSON.stringify({ manualEntry: true, purchaseIntentId, amountClp }) });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo registrar el pago'); return; }
    window.usdtLoadReviewQueue();
  };

  window.usdtConfirmReview = async function(transferId){
    const sel = document.getElementById('usdtReviewSelect_' + transferId);
    const purchaseIntentId = Number(sel?.value);
    if(!purchaseIntentId){ onzeAlert('Elige a qué solicitud asociarla.'); return; }
    const res = await usdtFetch('/api/admin/usdt-payment-review', { method: 'PATCH', body: JSON.stringify({ transferId, purchaseIntentId }) });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo asociar'); return; }
    window.usdtLoadReviewQueue();
  };

  window.usdtDiscardReview = async function(transferId){
    if(!(await onzeConfirm('¿Descartar esta transferencia? (no se asociará a ninguna compra)'))) return;
    const res = await usdtFetch('/api/admin/usdt-payment-review', { method: 'PATCH', body: JSON.stringify({ transferId, discard: true }) });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo descartar'); return; }
    window.usdtLoadReviewQueue();
  };

  window.usdtToggleSelectAllReview = function(checkbox){
    document.querySelectorAll('.usdtReviewCheckbox').forEach(function(cb){ cb.checked = checkbox.checked; });
  };

  window.usdtDiscardSelectedReview = async function(){
    const ids = Array.from(document.querySelectorAll('.usdtReviewCheckbox:checked')).map(function(cb){ return Number(cb.dataset.transferId); });
    if(!ids.length){ onzeAlert('No seleccionaste ninguna transferencia.'); return; }
    if(!(await onzeConfirm(`¿Descartar ${ids.length} transferencia(s) seleccionada(s)? (no se asociarán a ninguna compra)`))) return;
    const res = await usdtFetch('/api/admin/usdt-payment-review', { method: 'PATCH', body: JSON.stringify({ transferIds: ids, discard: true }) });
    if(!res.ok){ onzeAlert(res.error || 'No se pudo descartar'); return; }
    window.usdtLoadReviewQueue();
  };

  /* ————— Historial de compras ————— */

  window.usdtLoadPurchaseHistory = async function(){
    const res = await usdtFetch('/api/admin/usdt-purchase-history');
    const list = document.getElementById('usdtPurchaseHistoryList');
    if(!list) return;
    if(!res.ok){ list.innerHTML = '<div style="color:#fb7185;font-size:12px;">' + (res.error||'Error al cargar') + '</div>'; return; }
    if(!res.purchases?.length){
      list.innerHTML = '<div style="color:#64748b;font-size:12px;">Sin compras realizadas todavía.</div>';
      return;
    }
    list.innerHTML = res.purchases.map(function(p){
      const date = p.executedAt ? new Date(p.executedAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '';
      return `<div style="background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px;padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <strong style="color:#fff;">${p.clientName}</strong>
            <span style="color:#8aa0ba;font-size:12px;margin-left:8px;">${p.clientEmail} · ${date}</span>
          </div>
          <span style="color:#64748b;font-size:11px;">${p.referenceCode}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:13px;">
          <span style="color:#8aa0ba;">${usdtMoney(p.receivedClp)} CLP</span>
          <strong style="color:#34d399;">${usdtMoney(p.usdtAmount, 2)} USDT</strong>
          ${p.executedRate ? `<span style="color:#64748b;">a ${usdtMoney(p.executedRate, 2)} CLP/USDT</span>` : ''}
        </div>
      </div>`;
    }).join('');
  };

  function initUsdtClients(){
    buildUsdtClientsView();
    addUsdtClientsNavButton();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(initUsdtClients, 500); });
  } else {
    setTimeout(initUsdtClients, 500);
  }
})();
