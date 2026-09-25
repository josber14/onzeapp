
(function(){
  "use strict";

  // Estado del editor
  let currentList = null;       // La lista que se está editando
  let currentPairs = [];        // Pares en memoria { originId, destId, originName, destName, customProfitPct }
  let csvData = null;           // Snapshot del CSV para Crea tu tasa del día
  let countriesCache = [];      // Lista de países desde la BD

  const RATE_LIST_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Teo-_5ka3LKx7FXL3x3yV3uf4KhoI61ewnVJyJ90XRnksoObf4CDn-lJvrFKiQ/pub?gid=119557813&single=true&output=csv";

  // ============================================================
  // HELPERS
  // ============================================================
  function getEl(id) { return document.getElementById(id); }

  function getCurrentListSettings() {
    try {
      return currentList && currentList.notes ? JSON.parse(currentList.notes) : {};
    } catch {
      return {};
    }
  }

  function getCurrentProfitMode() {
    const settings = getCurrentListSettings();
    return settings.profitMode || "custom";
  }

  function readEditorLogoFileAsDataUrl(file) {
    return new Promise(function(resolve, reject) {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateEditorBrandFields() {
    const settings = getCurrentListSettings();
    const companyInput = getEl("rateListEditorCompanyName");
    const logoInput = getEl("rateListEditorLogo");
    const removeLogo = getEl("rateListEditorRemoveLogo");
    const status = getEl("rateListEditorLogoStatus");

    if (companyInput) companyInput.value = settings.companyName || "";
    if (logoInput) logoInput.value = "";
    if (removeLogo) removeLogo.checked = false;

    if (status) {
      status.textContent = settings.logoDataUrl
        ? "Logo actual: logo cargado correctamente."
        : "Logo actual: sin logo cargado.";
    }
  }

  function getEditorSelectedProfitMode() {
    const checked = document.querySelector('input[name="rateListEditorProfitMode"]:checked');
    return checked ? checked.value : getCurrentProfitMode();
  }

  function updateEditorProfitModeFields() {
    const settings = getCurrentListSettings();
    const mode = settings.profitMode || "custom";
    const fixedRadio = document.querySelector('input[name="rateListEditorProfitMode"][value="fixed"]');
    const customRadio = document.querySelector('input[name="rateListEditorProfitMode"][value="custom"]');
    const profitInput = getEl("rateListEditorProfit");

    if (fixedRadio) fixedRadio.checked = mode === "fixed";
    if (customRadio) customRadio.checked = mode !== "fixed";

    if (profitInput) {
      if (mode === "fixed") {
        profitInput.disabled = false;
        profitInput.placeholder = "4";
        if (!profitInput.value) profitInput.value = currentList?.defaultProfitPct || "0";
      } else {
        profitInput.disabled = true;
        profitInput.value = "";
        profitInput.placeholder = "Ganancia variable por par";
      }
    }
  }

  function handleEditorProfitModeChange() {
    const settings = getCurrentListSettings();
    const selectedMode = getEditorSelectedProfitMode();

    if (currentList) {
      currentList.notes = JSON.stringify({
        ...settings,
        profitMode: selectedMode
      });
    }

    updateEditorProfitModeFields();
    updateRateDayProfitConfigVisibility();
    renderPairs();
    resetRateImagePreview();
  }

  function toggleRateListDetails() {
    const card = getEl("rateListDetailsCard");
    const btn = getEl("rateListEditorDetailsBtn");
    if (!card) return;

    const isOpen = card.classList.toggle("is-open");
    if (btn) btn.textContent = isOpen ? "Ocultar detalles" : "⚙️ Detalles";

    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function normalizeText(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseRateListCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cell);
        if (row.some(function(v){ return String(v).trim() !== ""; })) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }

    row.push(cell);
    if (row.some(function(v){ return String(v).trim() !== ""; })) rows.push(row);
    return rows;
  }

  function normalizeHeaderKey(s) {
    return normalizeText(s).replace(/[^a-z0-9]/g, "");
  }

  function findHeaderIndex(headers, candidates) {
    const normalizedHeaders = headers.map(normalizeHeaderKey);
    for (const candidate of candidates) {
      const key = normalizeHeaderKey(candidate);
      const idx = normalizedHeaders.indexOf(key);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function parseNumberLoose(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    let s = raw.replace(/\s/g, "").replace(/[^0-9,.-]/g, "");

    if (s.includes(",") && s.includes(".")) {
      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");
      if (lastComma > lastDot) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function buildRateListSnapshotFromCSV(rows) {
    if (!rows || rows.length < 2) return {};

    const headers = rows[0].map(function(h){ return String(h || "").trim(); });

    const originIdx = findHeaderIndex(headers, [
      "pais origen", "país origen", "origen", "desde", "country origin", "origin"
    ]);
    const destIdx = findHeaderIndex(headers, [
      "pais destino", "país destino", "destino", "hacia", "country destination", "destination", "dest"
    ]);

    const rateIdx = findHeaderIndex(headers, [
      "tasa", "tasa cliente", "cliente", "rate", "precio", "valor", "tasa web"
    ]);
    const detailIdx = findHeaderIndex(headers, [
      "tasa detal", "detal", "tasa detalle", "tasa final detal", "tasa oficial", "oficial"
    ]);
    const providerIdx = findHeaderIndex(headers, [
      "tasa proveedor", "proveedor", "tasa costo", "costo", "costrate", "cost", "provider"
    ]);
    const decimalsIdx = findHeaderIndex(headers, [
      "decimales", "decimals", "decimal"
    ]);

    if (originIdx < 0 || destIdx < 0) {
      console.warn("No pude detectar columnas origen/destino en CSV:", headers);
      return {};
    }

    const snapshot = {};

    rows.slice(1).forEach(function(r) {
      const origin = String(r[originIdx] || "").trim();
      const dest = String(r[destIdx] || "").trim();
      if (!origin || !dest) return;

      const rateRaw = rateIdx >= 0 ? r[rateIdx] : "";
      const detailRaw = detailIdx >= 0 ? r[detailIdx] : "";
      const providerRaw = providerIdx >= 0 ? r[providerIdx] : "";
      const decimalsRaw = decimalsIdx >= 0 ? r[decimalsIdx] : "";

      const rate = parseNumberLoose(rateRaw);
      const detailRate = parseNumberLoose(detailRaw);
      const providerRate = parseNumberLoose(providerRaw);
      const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : null;

      if (!snapshot[origin]) snapshot[origin] = [];
      snapshot[origin].push({
        dest: dest,
        rate: rate,
        detailRate: detailRate,
        detalRate: detailRate,
        officialRate: detailRate,
        providerRate: providerRate,
        costRate: providerRate,
        displayRate: rate,
        rawRate: rateRaw,
        rawDetailRate: detailRaw,
        rawDetalRate: detailRaw,
        rawProviderRate: providerRaw,
        decimals: decimals
      });
    });

    return snapshot;
  }

  async function loadRateListCSVSnapshot() {
    const url = RATE_LIST_CSV_URL + (RATE_LIST_CSV_URL.includes("?") ? "&" : "?") + "cacheBust=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo leer CSV tasas del día: HTTP " + res.status);
    const txt = await res.text();
    const rows = parseRateListCSV(txt);
    const snapshot = buildRateListSnapshotFromCSV(rows);
    csvData = snapshot;
    window.rateListDaySnapshot = snapshot;
    return snapshot;
  }

  // Pares donde se SUMA el margen (lógica idéntica a ONZE EXCEPTIONS_UP)
  const EXCEPTIONS_UP_KEYS = new Set([
    "argentina|usa",
    "chile|ecuador",
    "chile|espana",
    "chile|usa",
    "colombia|usa",
    "colombia|venezuela",
    "peru|ecuador"
  ]);

  function pairKey(originName, destName) {
    return normalizeText(originName) + "|" + normalizeText(destName);
  }

  function shouldAddMargin(originName, destName) {
    return EXCEPTIONS_UP_KEYS.has(pairKey(originName, destName));
  }

  // Cálculo de tasa cliente según lógica ONZE
  function calculateClientRate(providerRate, profitPct, originName, destName) {
    const p = Number(providerRate);
    const pct = Number(profitPct) / 100;
    if (!Number.isFinite(p) || !Number.isFinite(pct)) return null;
    if (shouldAddMargin(originName, destName)) {
      return p * (1 + pct);
    }
    return p * (1 - pct);
  }

  // Detecta decimales del valor (CLP/COP suelen no tener decimales)
  function detectDecimals(value, currencyCode) {
    const code = String(currencyCode || "").toUpperCase();
    if (code === "CLP" || code === "COP") return 0;
    const str = String(value);
    if (str.includes(".")) {
      const decPart = str.split(".")[1] || "";
      return Math.min(decPart.length, 6);
    }
    if (str.includes(",")) {
      const decPart = str.split(",")[1] || "";
      return Math.min(decPart.length, 6);
    }
    return 2;
  }

  function detectDecimalsFromRawRate(rawValue) {
    const str = String(rawValue ?? "").trim();
    if (!str) return 2;

    if (str.includes(",")) {
      const decPart = str.split(",").pop() || "";
      return Math.min(decPart.replace(/[^0-9]/g, "").length, 6);
    }

    if (str.includes(".")) {
      const decPart = str.split(".").pop() || "";
      return Math.min(decPart.replace(/[^0-9]/g, "").length, 6);
    }

    return 0;
  }

  function formatRate(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  // ============================================================
  // CARGA DE DATOS
  // ============================================================
  function loadHtml2CanvasOnce() {
    return new Promise(function(resolve, reject) {
      if (window.html2canvas) {
        resolve(window.html2canvas);
        return;
      }

      const existing = document.getElementById("html2canvasScript");
      if (existing) {
        existing.addEventListener("load", function() { resolve(window.html2canvas); });
        existing.addEventListener("error", reject);
        return;
      }

      const script = document.createElement("script");
      script.id = "html2canvasScript";
      script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      script.onload = function() {
        if (window.html2canvas) resolve(window.html2canvas);
        else reject(new Error("html2canvas no quedó disponible"));
      };
      script.onerror = function() {
        reject(new Error("No pude cargar html2canvas"));
      };
      document.head.appendChild(script);
    });
  }

  function openGeneratedRateImageForMobile(dataUrl, fileName) {
    const win = window.open("", "_blank");

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(fileName || "tasa-del-dia.png")}</title>
  <style>
    body{
      margin:0;
      min-height:100vh;
      background:#00122c;
      color:#fff;
      font-family:Arial,Helvetica,sans-serif;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:14px;
      padding:16px;
      box-sizing:border-box;
    }
    .hint{
      max-width:420px;
      background:#0d2950;
      border:1px solid #2b5a9a;
      border-radius:16px;
      padding:14px;
      line-height:1.4;
      font-size:15px;
      text-align:center;
    }
    img{
      width:100%;
      max-width:420px;
      height:auto;
      border-radius:18px;
      background:#fff;
      display:block;
    }
    a{
      color:#fff;
      background:#2563eb;
      text-decoration:none;
      font-weight:800;
      padding:12px 16px;
      border-radius:12px;
      display:inline-block;
    }
  </style>
</head>
<body>
  <div class="hint">
    Imagen lista. En iPhone mantén presionada la imagen y elige <strong>Guardar en Fotos</strong>.
  </div>
  <img src="${dataUrl}" alt="Imagen de tasas del día" />
  <a href="${dataUrl}" download="${escapeHtml(fileName || "tasa-del-dia.png")}">Intentar descargar</a>
</body>
</html>`;

    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      return true;
    }

    return false;
  }

  async function downloadRateImagePNG() {
    const node = document.getElementById("rateListImageCanvas");

    if (!node) {
      onzeAlert("Primero debes generar la imagen.");
      return;
    }

    const btn = document.getElementById("rateListImageDownloadBtn");
    const oldText = btn ? btn.textContent : "";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparando...";
      }

      const html2canvas = await loadHtml2CanvasOnce();

      const canvas = await html2canvas(node, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
        allowTaint: true,
        logging: false
      });

      const safeName = (currentList?.name || "tasa-del-dia")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñü]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "tasa-del-dia";

      const fileName = safeName + ".png";
      const dataUrl = canvas.toDataURL("image/png", 1);

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      const blob = await new Promise(function(resolve) {
        canvas.toBlob(resolve, "image/png", 1);
      });

      // iPhone/Safari: mostrar imagen en una pestaña/pantalla guardable.
      if (isIOS) {
        openGeneratedRateImageForMobile(dataUrl, fileName);
        return;
      }

      if (blob) {
        try {
          const file = new File([blob], fileName, { type: "image/png" });

          if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({
              files: [file],
              title: fileName,
              text: "Imagen de tasas del día"
            });
            return;
          }
        } catch (shareErr) {
          console.warn("No se pudo compartir archivo, uso descarga normal:", shareErr);
        }

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = fileName;
        link.href = blobUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(function() {
          URL.revokeObjectURL(blobUrl);
        }, 3000);

        return;
      }

      // Último respaldo: abrir imagen base64 guardable.
      openGeneratedRateImageForMobile(dataUrl, fileName);
    } catch (err) {
      console.error("Error descargando PNG:", err);
      onzeAlert("No pude preparar la imagen. Intenta actualizar la vista y descargar otra vez.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText || "Descargar PNG";
      }
    }
  }

  async function refreshRateDayRates() {
    const btn = document.getElementById("rateListImageRefreshBtn");
    const oldText = btn ? btn.textContent : "";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Actualizando...";
      }

      await loadRateListCSVSnapshot();

      if (typeof renderPairs === "function") {
        renderPairs();
      }

      if (typeof renderRateImagePreview === "function") {
        renderRateImagePreview();
      }

      if (typeof showToast === "function") {
        showToast("Vista actualizada con tasas nuevas del Sheet");
      }
    } catch (err) {
      console.error("Error actualizando vista tasas del día:", err);
      onzeAlert("No pude actualizar la vista con el Sheet. Revisa consola y me mandas el error.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText || "Actualizar vista";
      }
    }
  }

  window.refreshRateDayRates = refreshRateDayRates;

  window.addEventListener("resize", function() {
    if (document.getElementById("rateListImageCanvas")) {
      fitRateImagePreviewToScreen();
    }
  });

  window.downloadRateImagePNG = downloadRateImagePNG;

  async function loadCountriesFromDB() {
    try {
      // Crea tu tasa del día debe leer siempre el CSV directo,
      // porque ahí existe la columna "tasa detal".
      await loadRateListCSVSnapshot();
    } catch (err) {
      console.error("Error loadCountriesFromDB:", err);
      onzeAlert("No pude cargar las tasas del Sheet para Crea tu tasa del día.");
    }
  }

  function buildCountriesList() {
    // Construye lista única de países origen + destino desde el snapshot real de ONZE.
    // En ONZE lastDataSnapshot tiene forma: { ORIGEN: [ { dest, ...tasas } ] }
    if (!csvData) return [];
    const set = new Map();

    Object.keys(csvData).forEach(function(origin) {
      const originClean = String(origin).trim();
      if (originClean && !set.has(normalizeText(originClean))) {
        set.set(normalizeText(originClean), originClean);
      }

      const destinations = csvData[origin] || [];

      if (Array.isArray(destinations)) {
        destinations.forEach(function(item) {
          const destClean = String(item && (item.dest || item.destination || item.destName || "")).trim();
          if (destClean && !set.has(normalizeText(destClean))) {
            set.set(normalizeText(destClean), destClean);
          }
        });
      } else {
        Object.keys(destinations).forEach(function(dest) {
          const destClean = String(dest).trim();
          if (destClean && !set.has(normalizeText(destClean))) {
            set.set(normalizeText(destClean), destClean);
          }
        });
      }
    });

    return Array.from(set.values()).sort(function(a,b){
      return String(a).localeCompare(String(b), "es", { sensitivity: "base" });
    });
  }

  function populateCountrySelects() {
    const originSel = getEl("rateListEditorOrigin");
    const destSel = getEl("rateListEditorDestination");
    if (!originSel || !destSel) return;

    const countries = buildCountriesList();
    const optionsHtml = '<option value="">Selecciona...</option>' +
      countries.map(function(c) {
        return '<option value="' + c + '">' + c + '</option>';
      }).join("");
    originSel.innerHTML = optionsHtml;
    destSel.innerHTML = optionsHtml;
  }

  // ============================================================
  // GET TASA PROVEEDOR del CSV para un par
  // ============================================================
  function getRateRowFromCSV(originName, destName) {
    if (!csvData && window.rateListDaySnapshot) {
      csvData = window.rateListDaySnapshot;
    }
    if (!csvData && window.lastDataSnapshot) {
      csvData = window.lastDataSnapshot;
    }
    if (!csvData) return null;

    const origins = Object.keys(csvData);
    const matchOrigin = origins.find(function(o) {
      return normalizeText(o) === normalizeText(originName);
    });
    if (!matchOrigin) return null;

    const dests = csvData[matchOrigin] || [];

    if (Array.isArray(dests)) {
      return dests.find(function(item) {
        const destValue = item && (item.dest || item.destination || item.destName || item.to || "");
        return normalizeText(destValue) === normalizeText(destName);
      }) || null;
    }

    const matchDest = Object.keys(dests).find(function(d) {
      return normalizeText(d) === normalizeText(destName);
    });

    return matchDest ? dests[matchDest] : null;
  }

  function getRateDecimalsFromCSV(originName, destName) {
    const row = getRateRowFromCSV(originName, destName);
    if (!row) return 2;

    // En Mi imagen ONZE, la tasa oficial sale de "tasa detal",
    // así que los decimales también deben salir de esa misma columna.
    if (!isOperatorPercentImageMode()) {
      return detectDecimalsFromRawRate(
        row.rawDetailRate
        ?? row.rawDetalRate
        ?? row.detailRate
        ?? row.detalRate
        ?? row.officialRate
        ?? row.rawRate
        ?? row.displayRate
        ?? row.rate
      );
    }

    // En operador con % propio, mantenemos la lógica anterior.
    if (row.decimals != null && row.decimals !== "" && Number.isFinite(Number(row.decimals))) {
      return Number(row.decimals);
    }

    return detectDecimalsFromRawRate(
      row.rawRate
      ?? row.displayRate
      ?? row.rate
      ?? row.clientRate
      ?? row.providerRate
      ?? row.costRate
    );
  }

  function getProviderRateFromCSV(originName, destName) {
    const row = getRateRowFromCSV(originName, destName);
    if (!row) return null;

    // En "Operador con % propio" la base debe ser tasa proveedor/costo.
    // Si no existe una columna proveedor/costo, recién ahí usamos la tasa visible como respaldo.
    return row.providerRate
      ?? row.costRate
      ?? row.cost
      ?? row.rawProviderRate
      ?? row.rawCostRate
      ?? row["tasa proveedor"]
      ?? row["proveedor"]
      ?? row["tasa costo"]
      ?? row["costo"]
      ?? row.displayRate
      ?? row.rate
      ?? row.clientRate
      ?? row.tasa
      ?? row.valor
      ?? null;
  }

  function getRateDayCreatorMode() {
    return localStorage.getItem("onzeRateDayCreatorMode") || "official_onze";
  }

  function isOperatorPercentImageMode() {
    return getRateDayCreatorMode() === "operator_percent";
  }

  function updateRateDayCreatorModeUI() {
    const mode = getRateDayCreatorMode();
    const onzeBtn = getEl("rateDayModeOnzeBtn");
    const operatorBtn = getEl("rateDayModeOperatorBtn");
    const desc = getEl("rateDayModeDescription");

    if (onzeBtn) onzeBtn.classList.toggle("is-active", mode === "official_onze");
    if (operatorBtn) operatorBtn.classList.toggle("is-active", mode === "operator_percent");

    if (desc) {
      desc.textContent = mode === "operator_percent"
        ? "Prueba la visual de un operador que crea imágenes con su propio porcentaje."
        : "Crea tu imagen oficial ONZE con las tasas del día listas para compartir.";
    }
  }

  function setRateDayCreatorMode(mode) {
    localStorage.setItem("onzeRateDayCreatorMode", mode === "operator_percent" ? "operator_percent" : "official_onze");
    updateRateDayCreatorModeUI();

    if (typeof renderPairs === "function") renderPairs();
    if (typeof resetRateImagePreview === "function") resetRateImagePreview();
  }

  window.setRateDayCreatorMode = setRateDayCreatorMode;

  function truncateDecimals(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = Math.pow(10, decimals);
    return Math.trunc(n * factor) / factor;
  }

  function formatMovedThreeDigitsRate(value) {
    if (value == null || value === "") return "—";

    const rawText = String(value).trim();

    let digits = rawText.replace(/[^0-9]/g, "").replace(/^0+/, "");

    if (!digits) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "—";
      digits = Math.abs(n).toFixed(18).replace(/[^0-9]/g, "").replace(/^0+/, "");
    }

    if (!digits) return "0,00";

    digits = digits.slice(0, 3);

    while (digits.length < 3) {
      digits += "0";
    }

    return digits[0] + "," + digits.slice(1, 3);
  }

  function formatOfficialDailyRate(originName, destName, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";

    const key = pairKey(originName, destName);

    // Reglas especiales solo para Crea tu tasa del día / Mi imagen ONZE
    if (
      key === "usa|venezuela" ||
      key === "usa|chile" ||
      key === "espana|venezuela" ||
      key === "espana|chile" ||
      key === "peru|chile"
    ) {
      return n.toLocaleString("es-CL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    }

    // Colombia → Chile: truncar a 3 decimales, sin redondear
    if (key === "colombia|chile") {
      const truncated = truncateDecimals(n, 3);
      return truncated.toLocaleString("es-CL", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      });
    }

    // Chile → Perú: usar los primeros 3 números útiles de la tasa real, sin redondear.
    // Ejemplo: 0,000359 -> 3,59
    if (key === "chile|peru") {
      const row = getRateRowFromCSV(originName, destName);
      const raw = row?.rawDetailRate
        ?? row?.rawDetalRate
        ?? row?.detailRate
        ?? row?.detalRate
        ?? row?.officialRate
        ?? value;

      return formatMovedThreeDigitsRate(raw);
    }

    // México → Venezuela: 3 decimales
    if (key === "mexico|venezuela") {
      return n.toLocaleString("es-CL", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      });
    }

    // Colombia → Venezuela: 2 decimales, redondeado
    if (key === "colombia|venezuela") {
      return n.toLocaleString("es-CL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    // Argentina → Chile: 3 decimales
    if (key === "argentina|chile") {
      return n.toLocaleString("es-CL", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      });
    }

    // Regla normal: respetar decimales de la tasa detal del Sheet
    const decimals = getRateDecimalsFromCSV(originName, destName);
    return formatRate(n, decimals);
  }

  function getOfficialRateFromCSV(originName, destName) {
    // Para "Mi imagen ONZE" mostramos la tasa detal/oficial del Sheet.
    // Columna esperada: "tasa detal".
    const row = getRateRowFromCSV(originName, destName);
    if (!row) return null;

    return row.detailRate
      ?? row.detalRate
      ?? row.officialRate
      ?? row.tasaDetal
      ?? row["tasa detal"]
      ?? row.displayRate
      ?? row.rate
      ?? row.clientRate
      ?? row.tasa
      ?? row.valor
      ?? null;
  }

  // ============================================================
  // RENDER de pares
  // ============================================================
  function renderPairs() {
    const grid = getEl("rateListEditorPairsGrid");
    const empty = getEl("rateListEditorPairsEmpty");
    const count = getEl("rateListEditorPairCount");
    if (!grid || !empty || !count) return;

    count.textContent = currentPairs.length;

    if (currentPairs.length === 0) {
      grid.style.display = "none";
      empty.style.display = "block";
      grid.innerHTML = "";
      return;
    }

    empty.style.display = "none";
    grid.style.display = "grid";

    const operatorMode = isOperatorPercentImageMode();
    const profitMode = getCurrentProfitMode();
    const isFixedProfit = profitMode === "fixed";
    const globalProfit = isFixedProfit ? (Number(getEl("rateListEditorProfit").value) || 0) : 0;

    grid.innerHTML = currentPairs.map(function(p, idx) {
      const decimals = getRateDecimalsFromCSV(p.originName, p.destName);

      if (!operatorMode) {
        const officialRate = getOfficialRateFromCSV(p.originName, p.destName);
        const formattedOfficial = officialRate != null ? formatOfficialDailyRate(p.originName, p.destName, officialRate) : "—";

        return `
          <article class="rate-day-pair-card rate-pair-row" data-idx="${idx}">
            <div class="rate-day-pair-top">
              <div>
                <div class="rate-day-pair-kicker">Par #${idx + 1}</div>
                <strong class="rate-day-pair-route">${escapeHtml(p.originName)} → ${escapeHtml(p.destName)}</strong>
              </div>
              <button class="rate-pair-delete rate-day-trash-btn" data-idx="${idx}" type="button" title="Eliminar par" aria-label="Eliminar par">🗑️</button>
            </div>

            <div class="rate-day-pair-metrics">
              <div class="rate-day-metric rate-day-metric-final">
                <span>Tasa oficial ONZE</span>
                <strong class="rate-pair-final">${escapeHtml(formattedOfficial)}</strong>
              </div>
            </div>

          </article>
        `;
      }

      const provider = getProviderRateFromCSV(p.originName, p.destName);
      const effectivePct = p.customProfitPct != null && p.customProfitPct !== "" ? Number(p.customProfitPct) : globalProfit;
      const clientRate = provider != null ? calculateClientRate(provider, effectivePct, p.originName, p.destName) : null;
      const formatted = clientRate != null ? formatRate(clientRate, decimals) : "—";
      const formattedProvider = provider != null ? formatRate(provider, decimals) : "—";
      const modeLabel = p.customProfitPct != null && p.customProfitPct !== "" ? "Personalizado" : "Global";

      return `
        <article class="rate-day-pair-card rate-pair-row" data-idx="${idx}">
          <div class="rate-day-pair-top">
            <div>
              <div class="rate-day-pair-kicker">Par #${idx + 1}</div>
              <strong class="rate-day-pair-route">${escapeHtml(p.originName)} → ${escapeHtml(p.destName)}</strong>
            </div>
            <button class="rate-pair-delete rate-day-trash-btn" data-idx="${idx}" type="button" title="Eliminar par" aria-label="Eliminar par">🗑️</button>
          </div>

          <div class="rate-day-pair-metrics">
            <div class="rate-day-metric">
              <span>Tasa proveedor</span>
              <strong>${escapeHtml(formattedProvider)}</strong>
            </div>
            <div class="rate-day-metric rate-day-metric-final">
              <span>Tasa final imagen</span>
              <strong class="rate-pair-final">${escapeHtml(formatted)}</strong>
            </div>
          </div>

          <div class="rate-day-pair-bottom">
            ${
              isFixedProfit
                ? `<div class="rate-day-fixed-profit-note">Usa ganancia fija global: <strong>${globalProfit}%</strong></div>`
                : `<label class="rate-day-pct-label">
                    <span>% aplicado</span>
                    <div class="rate-day-pct-control">
                      <input type="number" step="0.01" min="0" placeholder="${globalProfit}" value="${p.customProfitPct != null ? p.customProfitPct : ""}" data-idx="${idx}" class="rate-pair-pct-input" />
                      <b>%</b>
                    </div>
                  </label>`
            }
            <span class="rate-pair-custom-mark rate-day-mode-pill" title="Tipo de porcentaje">${isFixedProfit ? "Fijo" : modeLabel}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  // ============================================================
  // ACCIONES
  // ============================================================
  async function handleAddPair() {
    const originSel = getEl("rateListEditorOrigin");
    const destSel = getEl("rateListEditorDestination");
    const origin = originSel.value.trim();
    const dest = destSel.value.trim();

    if (!origin || !dest) {
      onzeAlert("Selecciona país origen y destino.");
      return;
    }
    if (normalizeText(origin) === normalizeText(dest)) {
      onzeAlert("Origen y destino no pueden ser iguales.");
      return;
    }

    // Verificar duplicados
    const exists = currentPairs.some(function(p) {
      return normalizeText(p.originName) === normalizeText(origin) &&
             normalizeText(p.destName) === normalizeText(dest);
    });
    if (exists) {
      onzeAlert("Este par ya está en la lista.");
      return;
    }

    // Verificar que el par exista en el CSV
    const providerRate = getProviderRateFromCSV(origin, dest);
    if (providerRate == null) {
      onzeAlert("Este par no existe en el Sheet de tasas (no hay tasa proveedor).");
      return;
    }

    currentPairs.push({
      originName: origin,
      destName: dest,
      customProfitPct: null
    });

    originSel.value = "";
    destSel.value = "";
    renderPairs();
    // Guardar de inmediato para que el par no se pierda si el usuario navega
    // hacia atrás sin apretar "Guardar cambios".
    await persistCurrentList(true);
  }

  async function handlePairsGridClick(e) {
    const delBtn = e.target.closest(".rate-pair-delete");
    if (delBtn) {
      const idx = Number(delBtn.getAttribute("data-idx"));
      if (Number.isFinite(idx) && currentPairs[idx]) {
        currentPairs.splice(idx, 1);
        renderPairs();
        await persistCurrentList(true);
      }
    }
  }

  function handlePairsGridInput(e) {
    const inp = e.target.closest(".rate-pair-pct-input");
    if (inp) {
      const idx = Number(inp.getAttribute("data-idx"));
      if (Number.isFinite(idx) && currentPairs[idx]) {
        const v = inp.value.trim();
        currentPairs[idx].customProfitPct = v === "" ? null : Number(v);
        // Solo re-render la tasa final, no todo (evita perder el foco)
        const row = inp.closest(".rate-pair-row");
        if (row) {
          const globalProfit = Number(getEl("rateListEditorProfit").value) || 0;
          const p = currentPairs[idx];
          const provider = getProviderRateFromCSV(p.originName, p.destName);
          const effectivePct = p.customProfitPct != null ? Number(p.customProfitPct) : globalProfit;
          const clientRate = provider != null ? calculateClientRate(provider, effectivePct, p.originName, p.destName) : null;
          const decimals = getRateDecimalsFromCSV(p.originName, p.destName);
          const finalEl = row.querySelector(".rate-pair-final");
          if (finalEl) finalEl.textContent = clientRate != null ? formatRate(clientRate, decimals) : "—";
          const markEl = row.querySelector(".rate-pair-custom-mark");
          if (markEl) markEl.textContent = p.customProfitPct != null ? "Personalizado" : "Global";
        }
      }
    }
  }

  function handleProfitGlobalChange() {
    renderPairs();
  }

  // ============================================================
  // GUARDAR
  // ============================================================
  // silent=true se usa para auto-guardar pares apenas se agregan/quitan,
  // sin popups ni validar campos que el usuario no está tocando en ese momento.
  async function persistCurrentList(silent) {
    if (!currentList) return false;
    const name = getEl("rateListEditorName").value.trim();
    const profitMode = getEditorSelectedProfitMode();
    const profit = Number(getEl("rateListEditorProfit").value);

    if (!name) {
      if (!silent) onzeAlert("El nombre es obligatorio.");
      return false;
    }
    if (profitMode === "fixed" && (!Number.isFinite(profit) || profit < 0)) {
      if (!silent) onzeAlert("El % de ganancia es inválido.");
      return false;
    }

    // Resolver countryIds desde el nombre del país
    const countriesIndex = await ensureCountryIndex();
    const settings = getCurrentListSettings();
    const companyName = getEl("rateListEditorCompanyName")?.value?.trim() || "";
    const logoInput = getEl("rateListEditorLogo");
    const removeLogo = !!getEl("rateListEditorRemoveLogo")?.checked;

    let logoDataUrl = settings.logoDataUrl || null;

    if (removeLogo) {
      logoDataUrl = null;
    } else if (logoInput && logoInput.files && logoInput.files[0]) {
      try {
        logoDataUrl = await readEditorLogoFileAsDataUrl(logoInput.files[0]);
      } catch (err) {
        console.error("Error leyendo logo:", err);
        if (!silent) onzeAlert("No pude leer el logo. Intenta con otra imagen.");
        return false;
      }
    }

    const updatedSettings = {
      ...settings,
      profitMode: profitMode,
      companyName: companyName,
      logoDataUrl: logoDataUrl
    };

    const pairsForApi = currentPairs.map(function(p, idx) {
      const originCountry = countriesIndex[normalizeText(p.originName)];
      const destCountry = countriesIndex[normalizeText(p.destName)];
      if (!originCountry || !destCountry) return null;
      return {
        originCountryId: originCountry.id,
        destinationCountryId: destCountry.id,
        customProfitPct: p.customProfitPct,
        sortOrder: idx
      };
    }).filter(function(x) { return x != null; });

    try {
      const res = await fetch("/api/rate-lists/" + currentList.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          defaultProfitPct: profitMode === "fixed" ? profit : 0,
          notes: JSON.stringify(updatedSettings),
          pairs: pairsForApi
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (!silent) onzeAlert("Error al guardar: " + (err.error || res.status));
        else console.error("Error auto-guardando par:", err.error || res.status);
        return false;
      }
      const data = await res.json();
      currentList = data.rateList;
      if (!silent) onzeAlert("Cambios guardados ✓");
      return true;
    } catch (err) {
      console.error("Error save:", err);
      if (!silent) onzeAlert("Error de conexión al guardar.");
      return false;
    }
  }

  async function handleSave() {
    await persistCurrentList(false);
  }

  // Cache de países (id por nombre normalizado)
  let countryIndexPromise = null;
  function ensureCountryIndex() {
    if (countryIndexPromise) return countryIndexPromise;
    countryIndexPromise = (async function() {
      try {
        const res = await fetch("/api/countries", { cache: "no-store" });
        if (!res.ok) {
          // Fallback: si no existe el endpoint, devolvemos vacío
          return {};
        }
        const data = await res.json();
        const list = data.countries || data || [];
        const idx = {};
        list.forEach(function(c) {
          if (c && c.name) idx[normalizeText(c.name)] = c;
          if (c && c.code) idx[normalizeText(c.code)] = c;
        });
        return idx;
      } catch {
        return {};
      }
    })();
    return countryIndexPromise;
  }

  // ============================================================
  // ABRIR / CERRAR EDITOR
  // ============================================================
  async function openEditor(listId) {
    resetRateImagePreview();
    try {
      const res = await fetch("/api/rate-lists/" + listId, { cache: "no-store" });
      if (!res.ok) {
        onzeAlert("No se pudo abrir la lista.");
        return;
      }
      const data = await res.json();
      currentList = data.rateList;

      // Cargar datos al editor
      getEl("rateListEditorTitle").textContent = "Editar lista: " + currentList.name;
      getEl("rateListEditorName").value = currentList.name || "";
      getEl("rateListEditorProfit").value = currentList.defaultProfitPct || "0";
      const editorProfitInput = getEl("rateListEditorProfit");
      const profitMode = getCurrentProfitMode();
      if (editorProfitInput) {
        if (profitMode === "custom") {
          editorProfitInput.disabled = true;
          editorProfitInput.value = "";
          editorProfitInput.placeholder = "Ganancia variable por par";
        } else {
          editorProfitInput.disabled = false;
          editorProfitInput.placeholder = "4";
        }
      }

      const detailsCard = getEl("rateListDetailsCard");
      const detailsBtn = getEl("rateListEditorDetailsBtn");
      if (detailsCard) detailsCard.classList.remove("is-open");
      if (detailsBtn) detailsBtn.textContent = "⚙️ Detalles";

      updateEditorBrandFields();
      updateEditorProfitModeFields();
      updateRateDayProfitConfigVisibility();

      currentPairs = (currentList.pairs || []).map(function(p) {
        return {
          originName: p.originCountry?.name || "",
          destName: p.destinationCountry?.name || "",
          customProfitPct: p.customProfitPct != null ? Number(p.customProfitPct) : null
        };
      });

      await loadCountriesFromDB();
      populateCountrySelects();
      renderPairs();

      // Cambiar a la vista del editor
      document.querySelectorAll(".view").forEach(function(v) { v.classList.remove("active"); });
      getEl("view-rate-list-editor").classList.add("active");
    } catch (err) {
      console.error("Error openEditor:", err);
      onzeAlert("Error al abrir el editor.");
    }
  }

  function closeEditor() {
    resetRateImagePreview();
    currentList = null;
    currentPairs = [];
    document.querySelectorAll(".view").forEach(function(v) { v.classList.remove("active"); });
    getEl("view-tasa-del-dia").classList.add("active");
    // Refrescar las listas
    if (typeof window.__reloadRateLists === "function") {
      window.__reloadRateLists();
    }
  }

  // Exponer openEditor globalmente para que el script anterior pueda usarlo
  window.__openRateListEditor = openEditor;

  // ============================================================
  // GENERAR VISTA PREVIA DE IMAGEN
  // ============================================================
  function buildImageRows() {
    const operatorMode = isOperatorPercentImageMode();
    const globalProfit = Number(getEl("rateListEditorProfit")?.value) || 0;

    return currentPairs.map(function(p) {
      const decimals = getRateDecimalsFromCSV(p.originName, p.destName);

      let rateValue = null;

      if (operatorMode) {
        const provider = getProviderRateFromCSV(p.originName, p.destName);
        const effectivePct = p.customProfitPct != null && p.customProfitPct !== "" ? Number(p.customProfitPct) : globalProfit;
        rateValue = provider != null ? calculateClientRate(provider, effectivePct, p.originName, p.destName) : null;
      } else {
        rateValue = getOfficialRateFromCSV(p.originName, p.destName);
      }

      return {
        label: `${p.originName} - ${p.destName}`.toUpperCase(),
        rateText: rateValue == null
          ? "—"
          : (operatorMode ? formatRate(rateValue, decimals) : formatOfficialDailyRate(p.originName, p.destName, rateValue))
      };
    });
  }

  function fitRateImagePreviewToScreen() {
    const viewport = document.getElementById("rateListImagePreviewViewport");
    const canvas = document.getElementById("rateListImageCanvas");
    if (!viewport || !canvas) return;

    const available = Math.max(260, viewport.clientWidth - 24);
    const originalWidth = 900;
    const originalHeight = 1600;
    const scale = Math.min(1, available / originalWidth);

    canvas.style.transformOrigin = "top center";
    canvas.style.transform = `scale(${scale})`;
    canvas.style.margin = "0 auto";
    canvas.style.flex = "0 0 auto";

    const preview = document.getElementById("rateListImagePreview");
    if (preview) {
      preview.style.height = Math.ceil(originalHeight * scale) + "px";
      preview.style.overflow = "hidden";
      preview.style.alignItems = "flex-start";
    }
  }

  async function renderFreshRateImagePreview() {
    try {
      await loadRateListCSVSnapshot();

      if (typeof renderPairs === "function") {
        renderPairs();
      }

      if (typeof renderRateImagePreview === "function") {
        renderRateImagePreview();
      }
    } catch (err) {
      console.warn("No pude refrescar CSV antes de generar imagen:", err);
      if (typeof renderRateImagePreview === "function") {
        renderRateImagePreview();
      }
    }
  }

  window.renderFreshRateImagePreview = renderFreshRateImagePreview;

  function resetRateImagePreview() {
    const wrap = getEl("rateListImagePreviewWrap");
    const preview = getEl("rateListImagePreview");
    if (preview) preview.innerHTML = "";
    if (wrap) wrap.style.display = "none";
  }


  const RATE_DAY_TEMPLATES = [
    {
      id: "aki_exact",
      name: "Original",
      scope: "super_admin",
      brand: "AKI",
      description: "Usa la imagen real de AKI Transfer como fondo y solo escribe las tasas encima."
    },
    {
      id: "aki_original",
      name: "Dinámica",
      scope: "super_admin",
      brand: "AKI",
      description: "Diseño base editable de AKI Transfer."
    },
    {
      id: "aki_modern",
      name: "Moderna",
      scope: "super_admin",
      brand: "AKI",
      description: "Misma marca, estilo más limpio y moderno."
    },
    {
      id: "aki_premium",
      name: "Premium",
      scope: "super_admin",
      brand: "AKI",
      description: "Versión más elegante para publicaciones especiales."
    },
    {
      id: "onze_base",
      name: "Base",
      scope: "public",
      brand: "ONZE",
      description: "Diseño profesional con logo o marca personalizada."
    },
    {
      id: "onze_classic",
      name: "Clásica",
      scope: "public",
      brand: "ONZE",
      description: "Plantilla pública verde para operadores y clientes."
    },
    {
      id: "onze_dark",
      name: "Oscura",
      scope: "public",
      brand: "ONZE",
      description: "Plantilla pública oscura."
    },
    {
      id: "onze_halloween",
      name: "Halloween",
      scope: "public",
      brand: "ONZE",
      description: "Plantilla pública especial de Halloween."
    },
    {
      id: "onze_navidad",
      name: "Navidad",
      scope: "public",
      brand: "ONZE",
      description: "Plantilla pública especial de Navidad."
    }
  ];

  let rateDayAuthUser = null;

  function isRateDaySuperAdmin() {
    const params = new URLSearchParams(window.location.search || "");
    const roleFromUrl = String(params.get("role") || "").toLowerCase();

    if (roleFromUrl === "super_admin_global" || roleFromUrl === "super_admin_cliente") {
      return true;
    }

    const candidates = [
      rateDayAuthUser,
      window.currentUser,
      window.authUser,
      window.ONZE_USER,
      window.sessionUser,
      window.authenticatedUser
    ].filter(Boolean);

    return candidates.some(function(user) {
      return String(user.role || "").toLowerCase() === "super_admin_global"
        || String(user.role || "").toLowerCase() === "super_admin_cliente";
    });
  }

  function getRateDayDefaultTemplateId() {
    return isRateDaySuperAdmin() ? "aki_exact" : "onze_base";
  }

  function getRateDayTemplateId() {
    const stored = localStorage.getItem("onzeRateDayTemplateId");

    // Para el super admin, la base principal siempre debe ser AKI Original.
    // Si antes quedó guardado ONZE clásica por haber cargado antes de detectar usuario,
    // lo corregimos automáticamente.
    if (isRateDaySuperAdmin() && (!stored || stored === "onze_classic" || stored === "aki_original")) {
      return "aki_exact";
    }

    const exists = RATE_DAY_TEMPLATES.some(function(t) { return t.id === stored; });
    if (!exists) return getRateDayDefaultTemplateId();

    const template = RATE_DAY_TEMPLATES.find(function(t) { return t.id === stored; });
    if (template && template.scope === "super_admin" && !isRateDaySuperAdmin()) {
      return "onze_base";
    }

    return stored;
  }

  function getRateDayTemplate() {
    const id = getRateDayTemplateId();
    return RATE_DAY_TEMPLATES.find(function(t) { return t.id === id; }) || RATE_DAY_TEMPLATES[0];
  }

  function setRateDayTemplateId(id) {
    const template = RATE_DAY_TEMPLATES.find(function(t) { return t.id === id; });
    if (!template) return;

    if (template.scope === "super_admin" && !isRateDaySuperAdmin()) {
      localStorage.setItem("onzeRateDayTemplateId", "onze_classic");
    } else {
      localStorage.setItem("onzeRateDayTemplateId", template.id);
    }

    updateRateDayTemplateUI();

    const wrap = getEl("rateListImagePreviewWrap");
    if (wrap && wrap.style.display !== "none" && typeof renderRateImagePreview === "function") {
      renderRateImagePreview();
    } else {
      resetRateImagePreview();
    }
  }

  function resetRateDayTemplateToOriginal() {
    setRateDayTemplateId(getRateDayDefaultTemplateId());
  }

  function updateRateDayTemplateUI() {
    const mainSelect = getEl("rateDayTemplateSelect");
    const previewSelect = getEl("rateDayTemplatePreviewSelect");
    const resetBtn = getEl("rateDayTemplateResetBtn");
    const hint = getEl("rateDayTemplateHint");

    const currentId = getRateDayTemplateId();
    const allowed = RATE_DAY_TEMPLATES.filter(function(template) {
      return template.scope !== "super_admin" || isRateDaySuperAdmin();
    });

    const optionsHtml = allowed.map(function(template) {
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`;
    }).join("");

    const safeValue = allowed.some(function(t) { return t.id === currentId; })
      ? currentId
      : getRateDayDefaultTemplateId();

    [mainSelect, previewSelect].forEach(function(select) {
      if (!select) return;
      select.innerHTML = optionsHtml;
      select.value = safeValue;
    });

    const current = RATE_DAY_TEMPLATES.find(function(t) { return t.id === safeValue; });
    if (hint && current) {
      hint.textContent = current.description || "Plantilla dinámica para tasa del día.";
    }

    if (resetBtn) {
      resetBtn.style.display = "inline-flex";
      resetBtn.textContent = isRateDaySuperAdmin() ? "Volver al original" : "Volver a Base";
    }
  }

  async function loadRateDayAuthUser() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();

      if (data && data.ok && data.user) {
        rateDayAuthUser = data.user;

        if (isRateDaySuperAdmin()) {
          const stored = localStorage.getItem("onzeRateDayTemplateId");
          if (!stored || stored === "onze_classic" || stored === "aki_original") {
            localStorage.setItem("onzeRateDayTemplateId", "aki_exact");
          }
        }
      }
    } catch (err) {
      console.warn("No pude cargar usuario para plantillas:", err);
    } finally {
      updateRateDayTemplateUI();

      ["rateDayTemplateSelect", "rateDayTemplatePreviewSelect"].forEach(function(id) {
        const select = getEl(id);
        if (select && isRateDaySuperAdmin()) {
          select.value = getRateDayTemplateId();
        }
      });
    }
  }

  window.setRateDayTemplateId = setRateDayTemplateId;
  window.resetRateDayTemplateToOriginal = resetRateDayTemplateToOriginal;
  window.updateRateDayTemplateUI = updateRateDayTemplateUI;
  window.loadRateDayAuthUser = loadRateDayAuthUser;

  function splitRateRows(rows) {
    return {
      left: rows.filter(function(_, idx) { return idx % 2 === 0; }),
      right: rows.filter(function(_, idx) { return idx % 2 !== 0; })
    };
  }

  function renderRateColumn(items, options) {
    const pairFont = options.pairFont || 25;
    const rateFont = options.rateFont || 38;
    const itemMargin = options.itemMargin || 16;
    const rateHeight = options.rateHeight || 52;
    const borderColor = options.borderColor || "#f5b500";
    const rateBg = options.rateBg || "rgba(0,80,55,.28)";
    const pairColor = options.pairColor || "#ffffff";
    const rateColor = options.rateColor || "#ffffff";
    const rateWeight = options.rateWeight || 950;
    const rateLetterSpacing = options.rateLetterSpacing || "1px";
    const rateLineHeight = options.rateLineHeight || "1";
    const rateTranslateY = options.rateTranslateY || "0px";

    return items.map(function(item) {
      return `
        <div style="margin-bottom:${itemMargin}px;text-align:center;">
          <div style="color:${pairColor};font-weight:950;font-size:${pairFont}px;line-height:1.02;letter-spacing:.8px;text-transform:uppercase;text-shadow:0 3px 5px rgba(0,0,0,.26);margin-bottom:8px;white-space:nowrap;">
            ${escapeHtml(item.label)}
          </div>
          <div style="height:${rateHeight}px;display:flex;align-items:center;justify-content:center;border:4px solid ${borderColor};border-radius:999px;background:${rateBg};color:${rateColor};font-weight:${rateWeight};font-size:${rateFont}px;line-height:${rateLineHeight};letter-spacing:${rateLetterSpacing};text-shadow:0 2px 4px rgba(0,0,0,.24);box-shadow:0 10px 22px rgba(0,0,0,.14);">
            <span style="display:block;transform:translateY(${rateTranslateY});">${escapeHtml(item.rateText)}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function getRateImageBrandHtml(brandName, logoDataUrl, templateId) {
    if (logoDataUrl) {
      return `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(brandName)}" style="max-width:230px;max-height:105px;object-fit:contain;display:block;" />`;
    }

    if (templateId.indexOf("aki_") === 0) {
      return `
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:62px;height:62px;border-radius:999px;background:#ffffff;display:flex;align-items:center;justify-content:center;color:#0b8f45;font-weight:950;font-size:30px;">A</div>
          <div style="font-size:48px;line-height:.9;font-weight:950;letter-spacing:-2px;color:#ffffff;text-shadow:0 4px 10px rgba(0,0,0,.28);">
            AKI <span style="color:#f5b500;">TRANSFER</span>
          </div>
        </div>
      `;
    }

    return `<div style="padding:13px 24px;border-radius:20px;background:rgba(255,255,255,.95);color:#228B22;font-weight:950;font-size:34px;letter-spacing:-1px;">${escapeHtml(brandName || "ONZE")}</div>`;
  }

  function renderAkiExactTemplate(rows) {
    const positions = [
      { left: 120, top: 305, width: 306, height: 60 },
      { left: 483, top: 305, width: 306, height: 60 },
      { left: 120, top: 416, width: 306, height: 60 },
      { left: 483, top: 416, width: 306, height: 60 },
      { left: 120, top: 529, width: 306, height: 60 },
      { left: 483, top: 529, width: 306, height: 60 },
      { left: 120, top: 642, width: 306, height: 60 },
      { left: 483, top: 642, width: 306, height: 60 },
      { left: 120, top: 755, width: 306, height: 60 },
      { left: 483, top: 755, width: 306, height: 60 },
      { left: 120, top: 868, width: 306, height: 60 },
      { left: 483, top: 868, width: 306, height: 60 },
      { left: 120, top: 982, width: 306, height: 60 },
      { left: 483, top: 982, width: 306, height: 60 },
      { left: 120, top: 1095, width: 306, height: 60 },
      { left: 483, top: 1095, width: 306, height: 60 },
      { left: 120, top: 1208, width: 306, height: 60 },
      { left: 483, top: 1208, width: 306, height: 60 },
      { left: 120, top: 1321, width: 306, height: 60 },
      { left: 483, top: 1321, width: 306, height: 60 }
    ];

    const rateHtml = rows.slice(0, 20).map(function(item, idx) {
      const pos = positions[idx];
      if (!pos) return "";

      return `
        <div style="position:absolute;left:${pos.left}px;top:${pos.top}px;width:${pos.width}px;height:${pos.height}px;display:flex;align-items:center;justify-content:center;color:#ffffff;font-family:Arial, Helvetica, sans-serif;font-size:40px;font-weight:950;letter-spacing:.8px;text-shadow:0 3px 5px rgba(0,0,0,.28);line-height:1;">
          ${escapeHtml(item.rateText)}
        </div>
      `;
    }).join("");

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;position:relative;overflow:hidden;background:#085b40;font-family:Arial, Helvetica, sans-serif;">
        <img src="/templates/aki-transfer-original.jpg" alt="AKI Transfer Original" style="position:absolute;inset:0;width:900px;height:1600px;object-fit:cover;display:block;" />
        ${rateHtml}
      </div>
    `;
  }

  function renderOnzeBaseTemplate(rows, listName, brandName, logoDataUrl, dateText) {
    const split = splitRateRows(rows);
    const total = rows.length;

    const pairFont = total <= 10 ? 32 : total > 20 ? 22 : 28;
    const rateFont = total <= 10 ? 46 : total > 20 ? 28 : 38;
    const itemMargin = total <= 10 ? 30 : total > 20 ? 11 : 17;
    const rateHeight = total <= 10 ? 68 : total > 20 ? 50 : 58;

    const cleanBrand = String(brandName || "").trim();

    const brandHtml = logoDataUrl
      ? `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(cleanBrand || "Marca")}" style="max-width:240px;max-height:105px;object-fit:contain;display:block;margin:0 auto;" />`
      : (cleanBrand
        ? `<div style="display:inline-flex;align-items:center;justify-content:center;padding:15px 28px;border-radius:24px;background:rgba(255,255,255,.96);color:#08743d;font-size:38px;line-height:1;font-weight:950;letter-spacing:-1px;box-shadow:0 12px 24px rgba(0,0,0,.18);">${escapeHtml(cleanBrand)}</div>`
        : "");

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;box-sizing:border-box;padding:82px 72px 54px;position:relative;overflow:hidden;background:#085b40;font-family:Arial, Helvetica, sans-serif;">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0a6044 0%,#07583d 52%,#064f38 100%);"></div>
        <div style="position:absolute;left:-160px;top:-120px;width:520px;height:520px;border-radius:999px;background:rgba(245,183,0,.12);filter:blur(2px);"></div>
        <div style="position:absolute;right:-180px;bottom:120px;width:520px;height:520px;border-radius:999px;background:rgba(255,255,255,.07);"></div>

        <div style="position:relative;z-index:1;text-align:center;height:100%;">
          <div style="height:155px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;">
            <div style="color:#ffffff;font-size:55px;line-height:1;font-weight:950;letter-spacing:.28em;text-transform:uppercase;margin-left:18px;">
              TASA
            </div>
            <div style="margin-top:8px;background:#f4b700;color:#07583d;border-radius:999px;padding:9px 42px 12px;min-width:360px;box-sizing:border-box;font-size:56px;line-height:1;font-weight:950;letter-spacing:.02em;text-transform:uppercase;">
              DEL DÍA
            </div>
          </div>

          <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;">
            <div>${renderRateColumn(split.left, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#e3aa08",
              rateBg:"transparent",
              pairColor:"#ffffff",
              rateColor:"#ffffff",
              rateWeight:500,
              rateLetterSpacing:"5px",
              rateLineHeight:"1.08",
              rateTranslateY:"-1px"
            })}</div>
            <div>${renderRateColumn(split.right, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#e3aa08",
              rateBg:"transparent",
              pairColor:"#ffffff",
              rateColor:"#ffffff",
              rateWeight:500,
              rateLetterSpacing:"5px",
              rateLineHeight:"1.08",
              rateTranslateY:"-1px"
            })}</div>
          </div>

          <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;min-height:118px;">
            ${brandHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderAkiOriginalTemplate(rows, listName, brandName, logoDataUrl, dateText) {
    const split = splitRateRows(rows);
    const total = rows.length;

    const pairFont = total <= 10 ? 32 : total > 20 ? 22 : 28;
    const rateFont = total <= 10 ? 48 : total > 20 ? 30 : 40;
    const itemMargin = total <= 10 ? 30 : total > 20 ? 11 : 17;
    const rateHeight = total <= 10 ? 68 : total > 20 ? 46 : 55;

    const logoHtml = logoDataUrl
      ? `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(brandName || "AKI TRANSFER")}" style="max-width:230px;max-height:100px;object-fit:contain;display:block;margin:0 auto;" />`
      : `
        <div style="text-align:center;color:#ffffff;">
          <div style="font-size:72px;line-height:.78;font-weight:950;letter-spacing:-5px;">AKI</div>
          <div style="margin-top:8px;font-size:18px;font-weight:950;letter-spacing:.42em;">TRANSFER</div>
          <div style="margin-top:5px;font-size:13px;font-weight:700;font-style:italic;letter-spacing:.14em;">¡Aquí y Ahora!</div>
        </div>
      `;

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;box-sizing:border-box;padding:82px 72px 54px;position:relative;overflow:hidden;background:#085b40;font-family:Arial, Helvetica, sans-serif;">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0a6044 0%,#07583d 52%,#064f38 100%);"></div>

        <div style="position:relative;z-index:1;text-align:center;height:100%;">
          <div style="height:155px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;">
            <div style="color:#ffffff;font-size:55px;line-height:1;font-weight:950;letter-spacing:.28em;text-transform:uppercase;margin-left:18px;">
              TASA
            </div>
            <div style="margin-top:8px;background:#f4b700;color:#07583d;border-radius:999px;padding:9px 42px 12px;min-width:360px;box-sizing:border-box;font-size:56px;line-height:1;font-weight:950;letter-spacing:.02em;text-transform:uppercase;">
              DEL DÍA
            </div>
          </div>

          <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;">
            <div>${renderRateColumn(split.left, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#e3aa08",
              rateBg:"transparent",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
            <div>${renderRateColumn(split.right, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#e3aa08",
              rateBg:"transparent",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
          </div>

          <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;">
            ${logoHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderAkiModernTemplate(rows, listName, brandName, logoDataUrl, dateText) {
    const split = splitRateRows(rows);
    const total = rows.length;

    const pairFont = total > 20 ? 20 : total <= 10 ? 30 : 24;
    const rateFont = total > 20 ? 29 : total <= 10 ? 45 : 35;
    const itemMargin = total > 20 ? 9 : total <= 10 ? 24 : 13;
    const rateHeight = total > 20 ? 43 : total <= 10 ? 62 : 48;

    const logoHtml = logoDataUrl
      ? `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(brandName || "AKI TRANSFER")}" style="max-width:210px;max-height:82px;object-fit:contain;display:block;margin:0 auto;" />`
      : `
        <div style="display:inline-flex;align-items:center;gap:14px;">
          <div style="width:58px;height:58px;border-radius:999px;background:#ffffff;color:#08743d;display:flex;align-items:center;justify-content:center;font-weight:950;font-size:32px;">A</div>
          <div>
            <div style="color:#ffffff;font-size:44px;font-weight:950;letter-spacing:-1.5px;line-height:.85;">AKI</div>
            <div style="color:#f5b500;font-size:17px;font-weight:950;letter-spacing:.38em;margin-top:8px;">TRANSFER</div>
          </div>
        </div>
      `;

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;box-sizing:border-box;padding:58px 58px 44px;position:relative;overflow:hidden;background:linear-gradient(160deg,#041f16 0%,#075b39 42%,#11a755 100%);font-family:Arial, Helvetica, sans-serif;">
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px, transparent 1px);background-size:38px 38px;opacity:.55;"></div>
        <div style="position:absolute;right:-160px;top:-120px;width:520px;height:520px;border-radius:999px;background:rgba(245,181,0,.20);filter:blur(2px);"></div>
        <div style="position:absolute;left:-180px;bottom:120px;width:520px;height:520px;border-radius:999px;background:rgba(255,255,255,.08);"></div>

        <div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:22px;">
            <div>
              <div style="display:inline-flex;align-items:center;padding:10px 18px;border-radius:999px;background:#f5b500;color:#063b24;font-size:18px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;">
                ${escapeHtml(dateText)}
              </div>
              <h1 style="margin:24px 0 0;color:#ffffff;font-size:78px;line-height:.86;font-weight:950;letter-spacing:-4px;text-transform:uppercase;text-shadow:0 8px 18px rgba(0,0,0,.26);">
                Tasas<br/>del día
              </h1>
            </div>
            <div style="max-width:270px;text-align:right;color:rgba(255,255,255,.86);font-size:20px;font-weight:900;line-height:1.2;">
              ${escapeHtml(listName)}
            </div>
          </div>

          <div style="margin-top:54px;display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">
            <div>${renderRateColumn(split.left, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#f5b500",
              rateBg:"rgba(255,255,255,.10)",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
            <div>${renderRateColumn(split.right, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#f5b500",
              rateBg:"rgba(255,255,255,.10)",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
          </div>

          <div style="margin-top:auto;padding-top:18px;display:flex;justify-content:center;align-items:center;">
            ${logoHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderAkiPremiumTemplate(rows, listName, brandName, logoDataUrl, dateText) {
    const split = splitRateRows(rows);
    const total = rows.length;

    const pairFont = total > 20 ? 20 : total <= 10 ? 30 : 24;
    const rateFont = total > 20 ? 29 : total <= 10 ? 45 : 35;
    const itemMargin = total > 20 ? 9 : total <= 10 ? 24 : 13;
    const rateHeight = total > 20 ? 43 : total <= 10 ? 62 : 48;

    const logoHtml = logoDataUrl
      ? `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(brandName || "AKI TRANSFER")}" style="max-width:215px;max-height:86px;object-fit:contain;display:block;margin:0 auto;" />`
      : `
        <div style="text-align:center;">
          <div style="color:#ffffff;font-size:62px;line-height:.78;font-weight:950;letter-spacing:-4px;">AKI</div>
          <div style="margin-top:9px;color:#f5b500;font-size:18px;font-weight:950;letter-spacing:.44em;">TRANSFER</div>
        </div>
      `;

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;box-sizing:border-box;padding:56px 56px 44px;position:relative;overflow:hidden;background:radial-gradient(circle at 50% -6%,#25d976 0%,#078046 34%,#02150f 100%);font-family:Arial, Helvetica, sans-serif;">
        <div style="position:absolute;inset:28px;border:2px solid rgba(245,181,0,.45);border-radius:44px;"></div>
        <div style="position:absolute;inset:40px;border:1px solid rgba(255,255,255,.10);border-radius:34px;"></div>
        <div style="position:absolute;left:-120px;top:230px;width:330px;height:330px;border-radius:999px;background:rgba(245,181,0,.11);filter:blur(1px);"></div>
        <div style="position:absolute;right:-130px;bottom:190px;width:360px;height:360px;border-radius:999px;background:rgba(255,255,255,.08);"></div>

        <div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;text-align:center;">
          <div>
            <div style="display:inline-flex;align-items:center;justify-content:center;padding:9px 22px;border-radius:999px;border:1px solid rgba(245,181,0,.55);background:rgba(245,181,0,.12);color:#f5b500;font-size:20px;font-weight:950;letter-spacing:.22em;text-transform:uppercase;">
              ${escapeHtml(brandName || "AKI TRANSFER")}
            </div>
            <h1 style="margin:22px 0 6px;color:#ffffff;font-size:82px;line-height:.88;font-weight:950;letter-spacing:-4px;text-transform:uppercase;text-shadow:0 9px 22px rgba(0,0,0,.34);">
              Tasas<br/>del día
            </h1>
            <div style="color:rgba(255,255,255,.82);font-size:20px;font-weight:850;">
              ${escapeHtml(listName)} · ${escapeHtml(dateText)}
            </div>
          </div>

          <div style="margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">
            <div>${renderRateColumn(split.left, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#f5b500",
              rateBg:"rgba(255,255,255,.095)",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
            <div>${renderRateColumn(split.right, {
              pairFont,
              rateFont,
              itemMargin,
              rateHeight,
              borderColor:"#f5b500",
              rateBg:"rgba(255,255,255,.095)",
              pairColor:"#ffffff",
              rateColor:"#ffffff"
            })}</div>
          </div>

          <div style="margin-top:auto;padding-top:16px;display:flex;justify-content:center;align-items:center;">
            ${logoHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderOnzeTemplate(rows, listName, brandName, logoDataUrl, dateText, variant) {
    const split = splitRateRows(rows);
    const halloween = variant === "onze_halloween";
    const navidad = variant === "onze_navidad";
    const dark = variant === "onze_dark";

    const bg = halloween
      ? "linear-gradient(160deg,#1a0d25 0%,#3b135c 46%,#f97316 100%)"
      : navidad
        ? "linear-gradient(160deg,#064e3b 0%,#0f8a45 50%,#b91c1c 100%)"
        : dark
          ? "linear-gradient(160deg,#020617 0%,#0f172a 52%,#14532d 100%)"
          : "linear-gradient(160deg,#052e1c 0%,#166534 48%,#22c55e 100%)";

    const accent = halloween ? "#fb923c" : navidad ? "#facc15" : "#f5b500";
    const emoji = halloween ? "🎃" : navidad ? "🎄" : "";

    return `
      <div id="rateListImageCanvas" style="width:900px;height:1600px;box-sizing:border-box;padding:72px 60px 54px;position:relative;overflow:hidden;background:${bg};font-family:Arial, Helvetica, sans-serif;">
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px, transparent 1px);background-size:34px 34px;opacity:.55;"></div>
        <div style="position:relative;z-index:1;text-align:center;">
          <div style="font-size:30px;font-weight:950;color:${accent};letter-spacing:.18em;text-transform:uppercase;">${emoji} ${escapeHtml(brandName || "ONZE")} ${emoji}</div>
          <h1 style="margin:22px 0 8px;color:#ffffff;font-size:76px;line-height:.9;font-weight:950;letter-spacing:-3px;text-transform:uppercase;">Tasas del día</h1>
          <div style="color:rgba(255,255,255,.78);font-size:20px;font-weight:800;">${escapeHtml(listName)} · ${escapeHtml(dateText)}</div>

          <div style="margin-top:62px;display:grid;grid-template-columns:1fr 1fr;gap:30px;">
            <div>${renderRateColumn(split.left, { pairFont:22, rateFont:35, itemMargin:14, rateHeight:49, borderColor:accent, rateBg:"rgba(255,255,255,.10)" })}</div>
            <div>${renderRateColumn(split.right, { pairFont:22, rateFont:35, itemMargin:14, rateHeight:49, borderColor:accent, rateBg:"rgba(255,255,255,.10)" })}</div>
          </div>

          <div style="margin-top:38px;color:rgba(255,255,255,.78);font-size:16px;font-weight:700;">
            Tasas referenciales sujetas a disponibilidad y confirmación.
          </div>

          <div style="margin-top:28px;display:flex;justify-content:center;">
            ${getRateImageBrandHtml(brandName || "ONZE", logoDataUrl, variant)}
          </div>
        </div>
      </div>
    `;
  }


  function renderRateImagePreview() {
    if (!currentList) return;

    if (!currentPairs.length) {
      onzeAlert("Agrega al menos un par antes de generar la imagen.");
      return;
    }

    const wrap = getEl("rateListImagePreviewWrap");
    const preview = getEl("rateListImagePreview");
    if (!wrap || !preview) return;

    updateRateDayTemplateUI();

    const listName = getEl("rateListEditorName").value.trim() || currentList.name || "Tasas del día";
    const settings = getCurrentListSettings();
    const template = getRateDayTemplate();
    const brandName = String(settings.companyName || "").trim() || (template.id.indexOf("aki_") === 0 ? "AKI TRANSFER" : "ONZE");
    const logoDataUrl = String(settings.logoDataUrl || "").trim();
    const rows = buildImageRows();

    const today = new Date();
    const dateText = today.toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });

    let html = "";

    if (template.id === "aki_exact") {
      html = renderAkiExactTemplate(rows);
    } else if (template.id === "onze_base") {
      html = renderOnzeBaseTemplate(rows, listName, brandName, logoDataUrl, dateText);
    } else if (template.id === "aki_original") {
      html = renderAkiOriginalTemplate(rows, listName, brandName, logoDataUrl, dateText);
    } else if (template.id === "aki_modern") {
      html = renderAkiModernTemplate(rows, listName, brandName, logoDataUrl, dateText);
    } else if (template.id === "aki_premium") {
      html = renderAkiPremiumTemplate(rows, listName, brandName, logoDataUrl, dateText);
    } else {
      html = renderOnzeTemplate(rows, listName, brandName, logoDataUrl, dateText, template.id);
    }

    preview.innerHTML = html;

    wrap.style.display = "block";
    fitRateImagePreviewToScreen();
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }


  // ============================================================
  // ROLE CLEANUP - TASA DEL DÍA
  // Solo el super admin ve el selector Mi imagen ONZE / Operador con %
  // ============================================================
  function getRateDaySafeParams() {
    return new URLSearchParams(window.location.search || "");
  }

  function getRateDaySafeRole() {
    return String(getRateDaySafeParams().get("role") || "").toLowerCase();
  }

  function getRateDaySafeOperatorMode() {
    return String(getRateDaySafeParams().get("operatorMode") || "").toLowerCase();
  }

  function isRateDaySafeAdmin() {
    const role = getRateDaySafeRole();

    if (role === "super_admin_global" || role === "super_admin_cliente") {
      return true;
    }

    const candidates = [
      rateDayAuthUser,
      window.currentUser,
      window.authUser,
      window.ONZE_USER,
      window.sessionUser,
      window.authenticatedUser
    ].filter(Boolean);

    return candidates.some(function(user) {
      const r = String(user.role || "").toLowerCase();
      return r === "super_admin_global" || r === "super_admin_cliente";
    });
  }

  function getForcedRateDayModeForNonAdmin() {
    if (isRateDaySafeAdmin()) return null;

    const mode = getRateDaySafeOperatorMode();

    // Libre mantiene lógica separada.
    if (mode.includes("libre") || mode.includes("free")) {
      return "operator_percent";
    }

    // Porcentaje fijo y socio usan siempre tasa oficial/detal ONZE.
    return "official_onze";
  }

  function getRateDayCreatorMode() {
    const forced = getForcedRateDayModeForNonAdmin();
    if (forced) return forced;

    return localStorage.getItem("onzeRateDayCreatorMode") || "official_onze";
  }

  function setRateDayCreatorMode(mode) {
    if (!isRateDaySafeAdmin()) {
      updateRateDayCreatorModeUI();
      return;
    }

    localStorage.setItem(
      "onzeRateDayCreatorMode",
      mode === "operator_percent" ? "operator_percent" : "official_onze"
    );

    updateRateDayCreatorModeUI();

    if (typeof renderPairs === "function") renderPairs();
    if (typeof resetRateImagePreview === "function") resetRateImagePreview();
  }

  function updateRateDayCreatorModeUI() {
    const card = document.getElementById("rateDayModeCard");
    const modeOnzeBtn = document.getElementById("rateDayModeOnzeBtn");
    const modeOperatorBtn = document.getElementById("rateDayModeOperatorBtn");

    if (card) {
      card.style.display = isRateDaySafeAdmin() ? "" : "none";
    }

    const mode = getRateDayCreatorMode();

    if (modeOnzeBtn) {
      modeOnzeBtn.classList.toggle("active", mode === "official_onze");
    }

    if (modeOperatorBtn) {
      modeOperatorBtn.classList.toggle("active", mode === "operator_percent");
    }
  }

  window.setRateDayCreatorMode = setRateDayCreatorMode;
  window.updateRateDayCreatorModeUI = updateRateDayCreatorModeUI;



  // ============================================================
  // ADMIN CREATOR TOGGLE FIX
  // Super admin puede alternar:
  // - official_onze: tasa detal
  // - operator_percent: tasa proveedor / % propio
  // No-admin no ve ni cambia este selector.
  // ============================================================
  function getRateDayFinalParams() {
    return new URLSearchParams(window.location.search || "");
  }

  function getRateDayFinalRole() {
    return String(getRateDayFinalParams().get("role") || "").toLowerCase();
  }

  function getRateDayFinalOperatorMode() {
    return String(getRateDayFinalParams().get("operatorMode") || "").toLowerCase();
  }

  function isRateDayFinalAdmin() {
    const role = getRateDayFinalRole();

    if (role === "super_admin_global" || role === "super_admin_cliente") {
      return true;
    }

    const candidates = [
      rateDayAuthUser,
      window.currentUser,
      window.authUser,
      window.ONZE_USER,
      window.sessionUser,
      window.authenticatedUser
    ].filter(Boolean);

    return candidates.some(function(user) {
      const r = String(user.role || "").toLowerCase();
      return r === "super_admin_global" || r === "super_admin_cliente";
    });
  }

  function getForcedRateDayFinalMode() {
    if (isRateDayFinalAdmin()) return null;

    const mode = getRateDayFinalOperatorMode();

    if (mode.includes("libre") || mode.includes("free")) {
      return "operator_percent";
    }

    return "official_onze";
  }

  function getRateDayCreatorMode() {
    const forced = getForcedRateDayFinalMode();
    if (forced) return forced;

    return localStorage.getItem("onzeRateDayCreatorMode") || "official_onze";
  }

  function setRateDayCreatorMode(mode) {
    if (!isRateDayFinalAdmin()) {
      updateRateDayCreatorModeUI();
      return;
    }

    const nextMode = mode === "operator_percent" ? "operator_percent" : "official_onze";
    localStorage.setItem("onzeRateDayCreatorMode", nextMode);

    updateRateDayCreatorModeUI();

    if (typeof renderPairs === "function") {
      renderPairs();
    }

    if (typeof resetRateImagePreview === "function") {
      resetRateImagePreview();
    }

    if (typeof showToast === "function") {
      showToast(nextMode === "operator_percent"
        ? "Modo operador con % propio activado"
        : "Modo Mi imagen ONZE activado");
    }
  }

  function updateRateDayProfitConfigVisibility() {
    const showProfitConfig = getRateDayCreatorMode() === "operator_percent";

    // Modal Nueva lista
    const newProfitInput = document.getElementById("rateDayNewListProfit");
    const newProfitRow = newProfitInput ? newProfitInput.closest(".form-row") : null;
    if (newProfitRow) newProfitRow.style.display = showProfitConfig ? "" : "none";

    const newProfitModeBlock = document.querySelector('input[name="rateDayProfitMode"]')?.closest(".rate-day-modal-full");
    if (newProfitModeBlock) newProfitModeBlock.style.display = showProfitConfig ? "" : "none";

    // Editor / Detalles de lista existente
    // No ocultamos todo rateListAdvancedDetails porque ahí también está el logo.
    // Solo ocultamos la configuración de porcentaje.
    const advancedDetails = document.getElementById("rateListAdvancedDetails");
    if (advancedDetails) advancedDetails.style.display = "";

    const editorProfitModeBlock = document.querySelector('input[name="rateListEditorProfitMode"]')?.closest(".rate-day-profit-mode-editor");
    if (editorProfitModeBlock) editorProfitModeBlock.style.display = showProfitConfig ? "" : "none";

    const editorProfitInput = document.getElementById("rateListEditorProfit");
    const editorProfitRow = editorProfitInput ? editorProfitInput.closest(".form-row") : null;
    if (editorProfitRow) editorProfitRow.style.display = showProfitConfig ? "" : "none";

    if (!showProfitConfig) {
      const fixedNewRadio = document.querySelector('input[name="rateDayProfitMode"][value="fixed"]');
      if (fixedNewRadio) fixedNewRadio.checked = true;

      const fixedEditorRadio = document.querySelector('input[name="rateListEditorProfitMode"][value="fixed"]');
      if (fixedEditorRadio) fixedEditorRadio.checked = true;

      if (newProfitInput) newProfitInput.value = newProfitInput.value || "0";
      if (editorProfitInput) editorProfitInput.value = editorProfitInput.value || "0";
    }
  }

  function updateRateDayCreatorModeUI() {
    const card = document.getElementById("rateDayModeCard") || document.querySelector(".rate-day-mode-switch-card");
    const modeOnzeBtn = document.getElementById("rateDayModeOnzeBtn");
    const modeOperatorBtn = document.getElementById("rateDayModeOperatorBtn");

    if (card) {
      card.style.display = isRateDayFinalAdmin() ? "" : "none";
    }

    const mode = getRateDayCreatorMode();
    updateRateDayProfitConfigVisibility();

    if (modeOnzeBtn) {
      modeOnzeBtn.classList.toggle("active", mode === "official_onze");
      modeOnzeBtn.classList.toggle("is-active", mode === "official_onze");
      modeOnzeBtn.setAttribute("aria-pressed", mode === "official_onze" ? "true" : "false");
    }

    if (modeOperatorBtn) {
      modeOperatorBtn.classList.toggle("active", mode === "operator_percent");
      modeOperatorBtn.classList.toggle("is-active", mode === "operator_percent");
      modeOperatorBtn.setAttribute("aria-pressed", mode === "operator_percent" ? "true" : "false");
    }

  }

  window.getRateDayCreatorMode = getRateDayCreatorMode;
  window.setRateDayCreatorMode = setRateDayCreatorMode;
  window.updateRateDayCreatorModeUI = updateRateDayCreatorModeUI;


  // ============================================================
  // INIT
  // ============================================================
  function init() {
    const modeOnzeBtn = getEl("rateDayModeOnzeBtn");
    const modeOperatorBtn = getEl("rateDayModeOperatorBtn");

    if (modeOnzeBtn) modeOnzeBtn.addEventListener("click", function() { setRateDayCreatorMode("official_onze"); });
    if (modeOperatorBtn) modeOperatorBtn.addEventListener("click", function() { setRateDayCreatorMode("operator_percent"); });
    updateRateDayCreatorModeUI();

    const backBtn = getEl("rateListEditorBackBtn");
    const addBtn = getEl("rateListEditorAddPairBtn");
    const saveBtn = getEl("rateListEditorSaveBtn");
    const detailsBtn = getEl("rateListEditorDetailsBtn");
    const profitInput = getEl("rateListEditorProfit");
    const pairsGrid = getEl("rateListEditorPairsGrid");

    if (backBtn) backBtn.addEventListener("click", closeEditor);
    if (addBtn) addBtn.addEventListener("click", handleAddPair);
    if (saveBtn) saveBtn.addEventListener("click", handleSave);
    if (detailsBtn) detailsBtn.addEventListener("click", toggleRateListDetails);
    document.querySelectorAll('input[name="rateListEditorProfitMode"]').forEach(function(radio) {
      radio.addEventListener("change", handleEditorProfitModeChange);
    });
    if (profitInput) profitInput.addEventListener("input", handleProfitGlobalChange);
    if (pairsGrid) {
      pairsGrid.addEventListener("click", handlePairsGridClick);
      pairsGrid.addEventListener("input", handlePairsGridInput);
    }

    const imgBtn = getEl("rateListEditorImageBtn");
    const imgBtnMini = getEl("rateListEditorImageBtnMini");
    const refreshImgBtn = getEl("rateListImageRefreshBtn");

    if (imgBtn) {
      imgBtn.addEventListener("click", renderFreshRateImagePreview);
    }
    if (imgBtnMini) {
      imgBtnMini.addEventListener("click", renderFreshRateImagePreview);
    }
    if (refreshImgBtn) {
      refreshImgBtn.addEventListener("click", refreshRateDayRates);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
