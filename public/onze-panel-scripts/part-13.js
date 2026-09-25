
(function(){
  "use strict";

  // Estado en memoria
  let rateLists = [];

  const ONZE_DEFAULT_RATE_PAIRS = [
    ["CHILE", "VENEZUELA"],
    ["USA", "VENEZUELA"],
    ["USA", "CHILE"],
    ["CHILE", "USA"],
    ["CHILE", "COLOMBIA"],
    ["COLOMBIA", "CHILE"],
    ["PERÚ", "VENEZUELA"],
    ["CHILE", "PERÚ"],
    ["ARGENTINA", "VENEZUELA"],
    ["CHILE", "ARGENTINA"],
    ["MÉXICO", "VENEZUELA"],
    ["CHILE", "MÉXICO"],
    ["ESPAÑA", "VENEZUELA"],
    ["ESPAÑA", "CHILE"],
    ["COLOMBIA", "VENEZUELA"],
    ["CHILE", "ECUADOR"],
    ["PERÚ", "CHILE"],
    ["ARGENTINA", "CHILE"],
    ["CHILE", "ESPAÑA"],
    ["CHILE", "BRASIL"],
  ];

  // Referencias a elementos del DOM
  function getEl(id) {
    return document.getElementById(id);
  }

  function normalizeRateListText(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function getRateListSettings(list) {
    try {
      return list && list.notes ? JSON.parse(list.notes) : {};
    } catch {
      return {};
    }
  }

  function getRateListProfitLabel(list) {
    const settings = getRateListSettings(list);
    const mode = settings.profitMode || "custom";
    if (mode === "fixed") {
      return "<strong>" + (list.defaultProfitPct || "0") + "%</strong> ganancia";
    }
    return "<strong>Ganancia</strong> variable";
  }

  // ============================================================
  // API: Traer todas las listas del usuario actual
  // ============================================================
  async function loadRateLists() {
    try {
      const res = await fetch("/api/rate-lists", { cache: "no-store" });
      if (!res.ok) {
        console.error("Error al cargar listas:", res.status);
        return;
      }
      const data = await res.json();
      rateLists = data.rateLists || [];
      renderRateLists();
    } catch (err) {
      console.error("Error en loadRateLists:", err);
    }
  }
  window.__reloadRateLists = loadRateLists;

  // ============================================================
  // API: Crear nueva lista
  // ============================================================
  async function createRateList(name, defaultProfitPct, notes) {
    try {
      const res = await fetch("/api/rate-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultProfitPct, notes })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onzeAlert("Error al crear lista: " + (err.error || res.status));
        return null;
      }
      const data = await res.json();
      return data.rateList;
    } catch (err) {
      console.error("Error en createRateList:", err);
      onzeAlert("Error de conexión al crear la lista.");
      return null;
    }
  }

  // ============================================================
  // API: Crear lista ONZE default con los 20 pares oficiales
  // ============================================================
  async function createOnzeDefaultRateList() {
    const profitStr = prompt("% de ganancia global para la lista ONZE default:", "4");
    if (profitStr === null) return;

    const profit = Number(profitStr);
    if (!Number.isFinite(profit) || profit < 0) {
      onzeAlert("Porcentaje inválido.");
      return;
    }

    try {
      const countriesRes = await fetch("/api/countries", { cache: "no-store" });
      if (!countriesRes.ok) {
        onzeAlert("No pude cargar los países desde la base de datos.");
        return;
      }

      const countriesData = await countriesRes.json();
      const countries = countriesData.countries || countriesData || [];
      const countriesIndex = {};

      countries.forEach(function(c) {
        if (!c) return;
        if (c.name) countriesIndex[normalizeRateListText(c.name)] = c;
        if (c.code) countriesIndex[normalizeRateListText(c.code)] = c;
      });

      const pairs = ONZE_DEFAULT_RATE_PAIRS.map(function(pair, idx) {
        const origin = countriesIndex[normalizeRateListText(pair[0])];
        const dest = countriesIndex[normalizeRateListText(pair[1])];

        if (!origin || !dest) {
          return {
            missing: true,
            originName: pair[0],
            destName: pair[1],
          };
        }

        return {
          originCountryId: origin.id,
          destinationCountryId: dest.id,
          customProfitPct: null,
          sortOrder: idx,
        };
      });

      const missing = pairs.filter(function(p) { return p.missing; });
      if (missing.length) {
        onzeAlert("Faltan países en la base de datos para crear la lista:\n\n" + missing.map(function(p) {
          return p.originName + " - " + p.destName;
        }).join("\n"));
        return;
      }

      const created = await createRateList("ONZE (default)", profit);
      if (!created || !created.id) return;

      const updateRes = await fetch("/api/rate-lists/" + created.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ONZE (default)",
          defaultProfitPct: profit,
          pairs: pairs,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.json().catch(function(){ return {}; });
        onzeAlert("Se creó la lista, pero no pude agregar los pares: " + (err.error || updateRes.status));
        return;
      }

      await loadRateLists();
      onzeAlert("Lista ONZE default creada ✓");
    } catch (err) {
      console.error("Error createOnzeDefaultRateList:", err);
      onzeAlert("Error al crear la lista ONZE default.");
    }
  }

  // ============================================================
  // API: Eliminar lista
  // ============================================================
  async function deleteRateList(id) {
    if (!(await onzeConfirm("¿Eliminar esta lista? Esta acción no se puede deshacer desde la interfaz."))) {
      return;
    }
    try {
      const res = await fetch("/api/rate-lists/" + id, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onzeAlert("Error al eliminar: " + (err.error || res.status));
        return;
      }
      await loadRateLists();
    } catch (err) {
      console.error("Error en deleteRateList:", err);
    }
  }

  // ============================================================
  // RENDER: Pintar las listas en pantalla
  // ============================================================
  function renderRateLists() {
    const emptyEl = getEl("rateListsEmpty");
    const gridEl = getEl("rateListsGrid");
    if (!emptyEl || !gridEl) return;

    if (!rateLists || rateLists.length === 0) {
      emptyEl.style.display = "block";
      gridEl.style.display = "none";
      gridEl.innerHTML = "";
      return;
    }

    emptyEl.style.display = "none";
    gridEl.style.display = "grid";

    gridEl.innerHTML = rateLists.map(function(list) {
      const pairCount = (list.pairs || []).length;
      const safeName = String(list.name || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const profitLabel = getRateListProfitLabel(list);
      return `
        <article class="rate-day-list-card" data-id="${list.id}">
          <div class="rate-day-list-top">
            <div>
              <div class="rate-day-list-kicker">Lista de tasas</div>
              <h3 class="rate-day-list-title">${safeName}</h3>
            </div>
            <button class="rate-list-card-delete rate-day-list-trash" data-action="delete" data-id="${list.id}" type="button" title="Eliminar lista" aria-label="Eliminar lista">🗑️</button>
          </div>

          <div class="rate-day-list-stats">
            <span>${profitLabel}</span>
            <span><strong>${pairCount}</strong> ${pairCount === 1 ? "par" : "pares"}</span>
          </div>

          <button class="btn small ghost rate-list-card-open rate-day-list-open" data-action="open" data-id="${list.id}" type="button">Abrir lista</button>
        </article>
      `;
    }).join("");
  }

  // ============================================================
  // EVENT: Click en "+ Nueva lista"
  // ============================================================
  function getNewRateListCreatorMode() {
    return localStorage.getItem("onzeRateDayCreatorMode") || "official_onze";
  }

  function applyNewRateListModalMode() {
    const mode = getNewRateListCreatorMode();
    const isOperatorPercent = mode === "operator_percent";

    const profitRow = getEl("rateDayNewListProfit")?.closest(".form-row");
    const choiceWrap = document.querySelector('input[name="rateDayProfitMode"]')?.closest(".rate-day-modal-full");
    const profitInput = getEl("rateDayNewListProfit");
    const modalText = document.querySelector("#rateDayNewListModal .rate-day-modal-header p");

    if (profitRow) profitRow.classList.toggle("rate-day-official-hidden", !isOperatorPercent);
    if (choiceWrap) choiceWrap.classList.toggle("rate-day-official-hidden", !isOperatorPercent);

    if (modalText) {
      modalText.textContent = isOperatorPercent
        ? "Configura la lista, el tipo de ganancia y la identidad que aparecerá en la imagen."
        : "Configura los detalles básicos de tu imagen oficial ONZE.";
    }

    if (!isOperatorPercent && profitInput) {
      profitInput.value = "";
      profitInput.disabled = true;
      profitInput.placeholder = "No aplica en imagen ONZE";
    }

    if (isOperatorPercent && typeof updateNewListProfitModeUI === "function") {
      updateNewListProfitModeUI();
    }
  }

  function openNewRateListModal() {
    const modal = getEl("rateDayNewListModal");
    if (!modal) return;
    getEl("rateDayNewListName").value = "";
    getEl("rateDayNewListProfit").value = "4";
    getEl("rateDayNewListCompany").value = "";
    const fixed = document.querySelector('input[name="rateDayProfitMode"][value="fixed"]');
    if (fixed) fixed.checked = true;
    updateNewListProfitModeUI();
    const logo = getEl("rateDayNewListLogo");
    if (logo) logo.value = "";
    applyNewRateListModalMode();

    modal.style.display = "flex";
    setTimeout(function(){ getEl("rateDayNewListName")?.focus(); }, 50);
  }

  function closeNewRateListModal() {
    const modal = getEl("rateDayNewListModal");
    if (modal) modal.style.display = "none";
  }

  function readFileAsDataUrl(file) {
    return new Promise(function(resolve, reject) {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateNewListProfitModeUI() {
    const modeEl = document.querySelector('input[name="rateDayProfitMode"]:checked');
    const profitInput = getEl("rateDayNewListProfit");
    const mode = modeEl ? modeEl.value : "fixed";
    if (!profitInput) return;

    if (mode === "custom") {
      profitInput.value = "";
      profitInput.disabled = true;
      profitInput.placeholder = "Se define por cada par";
    } else {
      profitInput.disabled = false;
      profitInput.placeholder = "4";
      if (!profitInput.value) profitInput.value = "4";
    }
  }

  async function handleCreateNewListFromModal() {
    const name = getEl("rateDayNewListName")?.value?.trim() || "";
    const profit = Number(getEl("rateDayNewListProfit")?.value);
    const companyName = getEl("rateDayNewListCompany")?.value?.trim() || "";
    const modeEl = document.querySelector('input[name="rateDayProfitMode"]:checked');
    const profitMode = modeEl ? modeEl.value : "fixed";
    const logoInput = getEl("rateDayNewListLogo");

    if (!name) {
      onzeAlert("Coloca el nombre de la lista.");
      return;
    }

    const creatorModeForValidation = getNewRateListCreatorMode();
    if (creatorModeForValidation === "operator_percent" && profitMode === "fixed" && (!Number.isFinite(profit) || profit < 0)) {
      onzeAlert("El % de ganancia es inválido.");
      return;
    }

    let logoDataUrl = null;
    try {
      logoDataUrl = await readFileAsDataUrl(logoInput && logoInput.files ? logoInput.files[0] : null);
    } catch (err) {
      console.error("Error leyendo logo:", err);
      onzeAlert("No pude leer el logo. Intenta con otra imagen.");
      return;
    }

    const creatorMode = getNewRateListCreatorMode();
    const isOperatorPercent = creatorMode === "operator_percent";

    const settings = {
      version: 1,
      creatorMode: creatorMode,
      imageRateMode: isOperatorPercent ? "operator_percent" : "official_onze",
      profitMode: isOperatorPercent ? profitMode : "official_onze",
      companyName: companyName,
      logoDataUrl: logoDataUrl,
      templateMode: "previous"
    };

    const created = await createRateList(
      name,
      isOperatorPercent && profitMode === "fixed" ? profit : 0,
      JSON.stringify(settings)
    );
    if (created) {
      closeNewRateListModal();
      await loadRateLists();
    }
  }

  function handleNewListClick() {
    openNewRateListModal();
  }

  // ============================================================
  // EVENT: Delegación de clicks en las cards
  // ============================================================
  function handleGridClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-id"));
    const action = btn.getAttribute("data-action");

    if (action === "delete") {
      deleteRateList(id);
    } else if (action === "open") {
      // TODO: abrir el editor de la lista (próximo paso)
      if(typeof window.__openRateListEditor==="function"){window.__openRateListEditor(id);}
    }
  }

  // ============================================================
  // INIT: Configurar listeners cuando el DOM está listo
  // ============================================================
  function init() {
    const newBtn = getEl("newRateListBtn");
    const defaultBtn = getEl("createOnzeDefaultRateListBtn");
    const gridEl = getEl("rateListsGrid");

    if (newBtn) {
      newBtn.addEventListener("click", handleNewListClick);
    }

    const modalCloseBtn = getEl("rateDayNewListCloseBtn");
    const modalCancelBtn = getEl("rateDayNewListCancelBtn");
    const modalCreateBtn = getEl("rateDayNewListCreateBtn");
    const modal = getEl("rateDayNewListModal");

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeNewRateListModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeNewRateListModal);
    if (modalCreateBtn) modalCreateBtn.addEventListener("click", handleCreateNewListFromModal);
    document.querySelectorAll('input[name="rateDayProfitMode"]').forEach(function(radio) {
      radio.addEventListener("change", updateNewListProfitModeUI);
    });
    if (modal) {
      modal.addEventListener("click", function(e) {
        if (e.target === modal) closeNewRateListModal();
      });
    }

    if (defaultBtn) {
      defaultBtn.addEventListener("click", createOnzeDefaultRateList);
    }
    if (gridEl) {
      gridEl.addEventListener("click", handleGridClick);
    }

    // Cargar las listas si el usuario abre el tab
    const tabBtn = document.querySelector('.nav-btn[data-view-target="tasa-del-dia"]');
    if (tabBtn) {
      tabBtn.addEventListener("click", function() {
        loadRateLists();
      });
    }

    // Cargar también al inicio si la vista ya está activa
    const view = getEl("view-tasa-del-dia");
    if (view && view.classList.contains("active")) {
      loadRateLists();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
