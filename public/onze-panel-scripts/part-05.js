
/* ===== ONZE v2 ENHANCEMENTS ===== */
(function(){
  if(window.__onzeEnhancementsLoaded) return;
  window.__onzeEnhancementsLoaded = true;

  function esc(s){ const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* --- CSV Export --- */
  function exportHistoryCSV(){
    const ops = typeof loadOperations === 'function' ? loadOperations() : [];
    if(!ops.length){ onzeAlert('No hay operaciones para exportar.'); return; }

    const headers = ['Fecha','Cliente','N° Operación','Tipo','Origen','Destino','Envía','Recibe','Tasa proveedor','Tu tasa','Ganancia','Moneda ganancia','Observación'];
    const rows = ops.map(op => [
      op.date || '',
      '"' + (op.clientName || '').replace(/"/g,'""') + '"',
      op.operationNumber || '',
      op.operationType || '',
      op.originCountry || '',
      op.destCountry || '',
      op.sendAmount || '',
      op.receiveAmount || '',
      op.providerRate || '',
      op.clientRate || '',
      op.profitValue || 0,
      op.profitCurrency || '',
      '"' + (op.note || '').replace(/"/g,'""') + '"'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onze_historial_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if(typeof showToast === 'function') showToast('CSV exportado');
  }

  /* --- Enhanced Dashboard: Weekly Chart --- */
  function renderWeeklyChart(){
    const container = document.getElementById('weeklyChart');
    if(!container) return;
    const ops = typeof loadOperations === 'function' ? loadOperations() : [];

    const days = [];
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    for(let i = 6; i >= 0; i--){
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0,10);
      days.push({ iso, label: dayNames[d.getDay()], day: d.getDate(), count: 0 });
    }

    ops.forEach(op => {
      const d = days.find(day => day.iso === op.date);
      if(d) d.count++;
    });

    const maxCount = Math.max(...days.map(d => d.count), 1);

    container.innerHTML = days.map(d => {
      const h = Math.max(4, (d.count / maxCount) * 100);
      return `<div class="weekly-bar-wrap">
        <span class="weekly-bar-count">${d.count}</span>
        <div class="weekly-bar" style="height:${h}%"></div>
        <span class="weekly-bar-label">${d.label} ${d.day}</span>
      </div>`;
    }).join('');
  }

  /* --- Enhanced Dashboard: Top Clients --- */
  function renderTopClients(){
    const grid = document.getElementById('topClientsGrid');
    const empty = document.getElementById('topClientsEmpty');
    if(!grid) return;

    const ops = typeof loadOperations === 'function' ? loadOperations() : [];
    const now = new Date();
    const monthOps = ops.filter(op => {
      const d = new Date(op.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const counts = {};
    monthOps.forEach(op => {
      const name = (op.clientName || 'Sin nombre').trim();
      counts[name] = (counts[name] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);

    if(!sorted.length){
      grid.innerHTML = '';
      if(empty) empty.style.display = 'block';
      return;
    }
    if(empty) empty.style.display = 'none';

    grid.innerHTML = sorted.map(([name, count], i) => `
      <div class="top-client-row">
        <div class="top-client-rank">${i + 1}</div>
        <div class="top-client-name">${esc(name)}</div>
        <div class="top-client-count">${count} ops</div>
      </div>
    `).join('');
  }

  /* --- Enhanced Dashboard: Top Routes --- */
  function renderTopRoutes(){
    const grid = document.getElementById('topRoutesGrid');
    const empty = document.getElementById('topRoutesEmpty');
    if(!grid) return;

    const ops = typeof loadOperations === 'function' ? loadOperations() : [];
    const counts = {};
    ops.forEach(op => {
      const route = `${op.originCountry || '?'} → ${op.destCountry || '?'}`;
      counts[route] = (counts[route] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if(!sorted.length){
      grid.innerHTML = '';
      if(empty) empty.style.display = 'block';
      return;
    }
    if(empty) empty.style.display = 'none';

    const maxCount = sorted[0][1];
    grid.innerHTML = sorted.map(([route, count]) => `
      <div class="top-route-row">
        <div class="top-route-label">${esc(route)}</div>
        <div class="top-route-bar-wrap"><div class="top-route-bar" style="width:${(count / maxCount * 100)}%"></div></div>
        <div class="top-route-count">${count}</div>
      </div>
    `).join('');
  }

  /* --- News Section Enhancements --- */
  function renderNewsSections(){
    const ops = typeof loadOperations === 'function' ? loadOperations() : [];

    // Rate summary from current data
    const rateSummary = document.getElementById('newsRateSummary');
    if(rateSummary && window.lastDataSnapshot){
      const data = window.lastDataSnapshot;
      const origins = Object.keys(data).slice(0, 4);
      let html = '';
      origins.forEach(origin => {
        const dests = data[origin].slice(0, 2);
        dests.forEach(d => {
          if(d.value && isFinite(d.value)){
            const flag1 = typeof getFlagEmoji === 'function' ? getFlagEmoji(origin) : '';
            const flag2 = typeof getFlagEmoji === 'function' ? getFlagEmoji(d.dest) : '';
            let valText = (d.providerRateText || d.valueText || (typeof fmtCL === 'function' ? fmtCL(d.value, d.decimals) : String(d.value)));

            if(keyFor(origin, d.dest) === keyFor("Chile","España") && Number.isFinite(d.value)){
              valText = String(Math.trunc(Number(d.value)));
            }

            if(keyFor(origin, d.dest) === keyFor("España","Venezuela") && Number.isFinite(d.value)){
              valText = String(Math.trunc(Number(d.value)));
            }

            html += `<div class="news-stat-row"><span class="news-stat-label">${flag1} ${origin} → ${flag2} ${d.dest}</span><span class="news-stat-value">${valText}</span></div>`;
          }
        });
      });
      rateSummary.innerHTML = html || '<div class="news-stat-row"><span class="news-stat-label">Cargando tasas...</span></div>';
    }

    // Tips
    const tipsEl = document.getElementById('newsTips');
    if(tipsEl){
      const tips = [
        'Revisa tus tasas antes de iniciar el día para ajustar tu margen.',
        'Usa la función de exportar CSV para llevar control en Excel.',
        'Registra todas las operaciones para un cierre diario preciso.',
        'Consulta el dashboard para identificar tus rutas más rentables.'
      ];
      const today = new Date().getDate();
      const selected = [tips[today % tips.length], tips[(today + 2) % tips.length]];
      tipsEl.innerHTML = selected.map(t => `<div class="news-tip-item">${t}</div>`).join('');
    }

    // Quick stats
    const quickStats = document.getElementById('newsQuickStats');
    if(quickStats){
      const totalOps = ops.length;
      const uniqueClients = new Set(ops.map(o => (o.clientName || '').toLowerCase().trim()).filter(Boolean)).size;
      const uniqueRoutes = new Set(ops.map(o => `${o.originCountry}-${o.destCountry}`)).size;
      quickStats.innerHTML = `
        <div class="news-stat-row"><span class="news-stat-label">Total operaciones</span><span class="news-stat-value">${totalOps}</span></div>
        <div class="news-stat-row"><span class="news-stat-label">Clientes únicos</span><span class="news-stat-value">${uniqueClients}</span></div>
        <div class="news-stat-row"><span class="news-stat-label">Rutas activas</span><span class="news-stat-value">${uniqueRoutes}</span></div>
      `;
    }

    // Currency summary
    const currSummary = document.getElementById('newsCurrencySummary');
    if(currSummary){
      const currencies = new Set();
      ops.forEach(op => {
        if(op.originCurrency) currencies.add(op.originCurrency);
        if(op.destCurrency) currencies.add(op.destCurrency);
        if(op.profitCurrency) currencies.add(op.profitCurrency);
      });
      if(currencies.size){
        currSummary.innerHTML = [...currencies].sort().map(c => `<span class="news-currency-tag">${c}</span>`).join('');
      } else {
        currSummary.innerHTML = '<span class="news-stat-label">Registra operaciones para ver tus monedas.</span>';
      }
    }

    // Activity hours
    const hoursEl = document.getElementById('newsActivityHours');
    if(hoursEl){
      const hourCounts = {};
      ops.forEach(op => {
        if(op.createdAt){
          const h = new Date(op.createdAt).getHours();
          const bucket = h < 6 ? 'Madrugada' : h < 12 ? 'Mañana' : h < 18 ? 'Tarde' : 'Noche';
          hourCounts[bucket] = (hourCounts[bucket] || 0) + 1;
        }
      });
      const periods = ['Madrugada','Mañana','Tarde','Noche'];
      const maxH = Math.max(...Object.values(hourCounts), 1);
      if(Object.keys(hourCounts).length){
        hoursEl.innerHTML = periods.filter(p => hourCounts[p]).map(p => `
          <div class="news-hour-bar-wrap">
            <span class="news-hour-label">${p}</span>
            <div class="news-hour-bar"><div class="news-hour-fill" style="width:${(hourCounts[p] / maxH * 100)}%"></div></div>
            <span class="news-hour-count">${hourCounts[p]}</span>
          </div>
        `).join('');
      } else {
        hoursEl.innerHTML = '<span class="news-stat-label">Sin datos de horarios aún.</span>';
      }
    }
  }

  /* --- Operator Notes --- */
  function loadOperatorNotes(){ return localStorage.getItem(NOTES_KEY) || ''; }
  function saveOperatorNotes(text){ localStorage.setItem(NOTES_KEY, text); }

  /* --- Cloud Backup --- */
  function getUserId(){
    let id = localStorage.getItem('onze_user_id');
    if(!id){
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem('onze_user_id', id);
    }
    return id;
  }

  async function backupToCloud(){
    try{
      const userId = getUserId();
      const operations = typeof loadOperations === 'function' ? loadOperations() : [];
      const profile = typeof loadProfile === 'function' ? loadProfile() : {};

      const resp = await fetch('/.netlify/functions/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, operations, profile })
      });
      const data = await resp.json();
      if(data.ok){
        if(typeof showToast === 'function') showToast('Respaldo guardado en la nube');
      } else {
        onzeAlert('Error al respaldar: ' + (data.error || 'desconocido'));
      }
    }catch(e){
      onzeAlert('No se pudo conectar al servidor de respaldo.');
    }
  }

  async function restoreFromCloud(){
    if(!(await onzeConfirm('Esto reemplazará tus datos locales con los del respaldo en la nube. ¿Continuar?'))) return;
    try{
      const userId = getUserId();
      const resp = await fetch(`/.netlify/functions/backup?userId=${encodeURIComponent(userId)}`);
      const data = await resp.json();

      if(!data.updatedAt){
        onzeAlert('No se encontró respaldo en la nube para este dispositivo.');
        return;
      }

      if(data.operations && Array.isArray(data.operations)){
        localStorage.setItem('aki_transfer_operations_v2', JSON.stringify(data.operations));
      }
      if(data.profile && typeof data.profile === 'object'){
        localStorage.setItem('onze_operator_profile_v1', JSON.stringify(data.profile));
      }

      if(typeof showToast === 'function') showToast('Datos restaurados desde la nube');
      if(typeof refreshHistoryUI === 'function') refreshHistoryUI();
      if(typeof refreshDashboard === 'function') refreshDashboard();
      if(typeof fillProfileForm === 'function') fillProfileForm();
    }catch(e){
      onzeAlert('No se pudo conectar al servidor de respaldo.');
    }
  }

  /* --- Refresh all enhanced UI --- */
  function refreshEnhancedUI(){
    renderWeeklyChart();
    renderTopClients();
    renderTopRoutes();
    renderNewsSections();

  }

  /* --- Monkey-patch refreshDashboard to also update enhanced sections --- */
  const origRefreshDashboard = window.refreshDashboard;
  if(typeof origRefreshDashboard === 'function'){
    window.refreshDashboard = function(){
      origRefreshDashboard.apply(this, arguments);
      renderWeeklyChart();
      renderTopClients();
      renderTopRoutes();
    };
  }

  /* --- Monkey-patch switchView to refresh enhanced sections on navigation --- */
  const origSwitchView = window.switchView;
  window.switchView = function(viewName){
    if(typeof origSwitchView === 'function') origSwitchView(viewName);
    if(viewName === 'ajustes'){
      window.scrollTo({top:0,behavior:'instant'});
      document.getElementById('view-ajustes')?.scrollIntoView({block:'start',behavior:'instant'});
    }
    if(viewName === 'dashboard'){ renderWeeklyChart(); renderTopClients(); renderTopRoutes(); }
    if(viewName === 'noticias'){
      document.getElementById('view-noticias')?.scrollIntoView({block:'start',behavior:'instant'});
      window.scrollTo({top:0,behavior:'instant'});
      renderNewsSections();
    }
  };

  /* --- Bind events --- */
  function bindEnhancedEvents(){
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if(exportCsvBtn) exportCsvBtn.onclick = exportHistoryCSV;

    if(addExpenseBtn){
      addExpenseBtn.onclick = async function(){
        const date = (expenseDate?.value || todayISO()).trim();
        const category = (expenseCategory?.value || "").trim();
        const country = String(expenseCountry?.value || "").trim();
        const currency = String(expenseCurrency?.value || "").trim().toUpperCase();
        const amount = Number(expenseAmount?.value || 0);
        const note = (expenseNote?.value || "").trim();

        if(!category){
          if(typeof showToast === 'function') showToast('Agrega una categoría');
          return;
        }

        if(!country){
          if(typeof showToast === 'function') showToast('Selecciona un país');
          expenseCountry?.focus();
          return;
        }

        if(!currency){
          if(typeof showToast === 'function') showToast('Moneda inválida');
          return;
        }

        if(!Number.isFinite(amount) || amount <= 0){
          if(typeof showToast === 'function') showToast('Agrega un monto válido');
          return;
        }

        try{
          const res = await fetch("/api/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date,
              category,
              country,
              currency,
              amount,
              note
            })
          });

          const data = await res.json().catch(()=>({}));

          if(!res.ok){
            throw new Error(data?.error || "No se pudo guardar el gasto.");
          }

          await fetchExpensesFromApi();

          if(expenseDate) expenseDate.value = todayISO();
          if(expenseCategory) expenseCategory.value = "";
          if(expenseCountry) expenseCountry.value = "";
          if(expenseCurrency) expenseCurrency.value = "";
          if(expenseAmount) expenseAmount.value = "";
          if(expenseNote) expenseNote.value = "";

          renderExpenses();
          renderInitialCapital();
          refreshDashboard();
          if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
            renderCountryDetail(pendingCountryDetail);
          }
          if(typeof showToast === 'function') showToast('Gasto guardado ✅');
        }catch(error){
          console.error("SAVE_EXPENSE_ERROR", error);
          if(typeof showToast === 'function') showToast(error?.message || 'No se pudo guardar el gasto');
        }
      };
    }

    const backupBtn = document.getElementById('backupBtn');
    if(backupBtn) backupBtn.onclick = backupToCloud;

    const restoreBtn = document.getElementById('restoreBtn');
    if(restoreBtn) restoreBtn.onclick = restoreFromCloud;

    const notesArea = document.getElementById('operatorNotes');
    if(notesArea) notesArea.value = loadOperatorNotes();

    const saveNotesBtn = document.getElementById('saveOperatorNotesBtn');
    if(saveNotesBtn) saveNotesBtn.onclick = function(){
      const text = document.getElementById('operatorNotes')?.value || '';
      saveOperatorNotes(text);
      if(typeof showToast === 'function') showToast('Notas guardadas');
    };

    if(capitalCountry){
      const countries = [
        "USDT",
        "Argentina",
        "Brasil",
        "Chile",
        "Colombia",
        "Ecuador",
        "España",
        "México",
        "Peru",
        "Uruguay",
        "USA",
        "Venezuela"
      ].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));

      capitalCountry.innerHTML = '<option value="">Selecciona un país…</option>';
      countries.forEach(country => {
        const opt = document.createElement('option');
        opt.value = country;
        opt.textContent = country;
        capitalCountry.appendChild(opt);
      });

      capitalCountry.onchange = function(){
        if(capitalCurrency){
          capitalCurrency.value = capitalCountry.value
            ? (capitalCountry.value === "USDT" ? "USDT" : getCurrencyFor(capitalCountry.value))
            : '';
        }
      };
    }

    if(openCapitalSetupBtn){
      openCapitalSetupBtn.onclick = function(){
        capitalCountry?.focus();
      };
    }

    if(expenseCountry){
      const expenseCountries = [
        "USDT",
        "Argentina",
        "Brasil",
        "Chile",
        "Colombia",
        "Ecuador",
        "España",
        "México",
        "Peru",
        "Uruguay",
        "USA",
        "Venezuela"
      ].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));

      expenseCountry.innerHTML = '<option value="">Selecciona un país…</option>';
      expenseCountries.forEach(country => {
        const opt = document.createElement('option');
        opt.value = country;
        opt.textContent = country;
        expenseCountry.appendChild(opt);
      });

      expenseCountry.onchange = function(){
        if(expenseCurrency){
          expenseCurrency.value = expenseCountry.value
            ? (expenseCountry.value === "USDT" ? "USDT" : getCurrencyFor(expenseCountry.value))
            : '';
        }
      };
    }

    if(saveCapitalBtn){
      saveCapitalBtn.onclick = async function(){
        const country = String(capitalCountry?.value || '').trim();
        const currency = String(capitalCurrency?.value || '').trim().toUpperCase();
        const amount = Number(String(capitalAmount?.value || '').replace(',', '.'));

        if(!country){
          if(typeof showToast === 'function') showToast('Debes indicar un país');
          capitalCountry?.focus();
          return;
        }

        if(!currency){
          if(typeof showToast === 'function') showToast('Debes indicar una moneda');
          capitalCurrency?.focus();
          return;
        }

        if(!Number.isFinite(amount) || amount < 0){
          if(typeof showToast === 'function') showToast('Monto inválido');
          capitalAmount?.focus();
          return;
        }

        try{
          const res = await fetch("/api/capital", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              country,
              currency,
              amount
            })
          });

          const data = await res.json().catch(()=>({}));

          if(!res.ok){
            throw new Error(data?.error || "No se pudo guardar el capital inicial.");
          }

          await fetchCapitalFromApi();

          if(capitalCountry) capitalCountry.value = '';
          if(capitalCurrency) capitalCurrency.value = '';
          if(capitalAmount) capitalAmount.value = '';

          renderInitialCapital();
          refreshDashboard();
          if(typeof pendingCountryDetail === "string" && pendingCountryDetail){
            renderCountryDetail(pendingCountryDetail);
          }
          if(typeof showToast === 'function') showToast('Capital inicial guardado ✅');
        }catch(error){
          console.error("SAVE_CAPITAL_ERROR", error);
          if(typeof showToast === 'function') showToast(error?.message || 'No se pudo guardar el capital inicial');
        }
      };
    }

  }

  document.addEventListener('DOMContentLoaded', function(){
    bindEnhancedEvents();
    renderInitialCapital();
    refreshEnhancedUI();
  });

  // Also bind immediately in case DOMContentLoaded already fired
  if(document.readyState !== 'loading'){
    bindEnhancedEvents();
    refreshEnhancedUI();
  }
})();
