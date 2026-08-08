// Lee y parsea la tabla "tasa de compra venta" de la hoja publicada de
// Google Sheets (pestaña "tasas web": G=país, H=compra, I=venta) -- misma
// URL y misma lógica EXACTA de parseo que ya usa public/onze-panel.html
// (norm/parseCSV/parseRate/buildCountryTradeRates), portada acá para poder
// llamarse desde el servidor (cron de historial de tasas, ver
// app/api/internal/rate-history-check/route.ts).
const RATE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Teo-_5ka3LKx7FXL3x3yV3uf4KhoI61ewnVJyJ90XRnksoObf4CDn-lJvrFKiQ/pub?gid=119557813&single=true&output=csv";

function norm(s: any): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function stripBOM(t: string): string {
  return t && t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

function parseCSV(text: string): string[][] {
  text = stripBOM(text);
  const rows: string[][] = [];
  let row: string[] = [],
    cur = "",
    inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      n = text[i + 1];
    if (c === '"') {
      if (inQuotes && n === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (cur !== "" || row.length) {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      }
      if (c === "\r" && n === "\n") i++;
    } else {
      cur += c;
    }
  }

  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows;
}

function parseRate(str: any): number {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (!s) return NaN;

  const low = s.toLowerCase();
  if (low.includes("error") || low.includes("#div/0") || low.includes("#n/a") || low.includes("#ref") || low.includes("#value")) return NaN;

  s = s.replace(/\$/g, "").replace(/\s+/g, "");

  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export interface CountryRateRow {
  country: string;
  buy: number | null;
  sell: number | null;
}

// Misma lógica EXACTA que buildCountryTradeRates() en public/onze-panel.html
// -- columnas G(6)=país H(7)=compra I(8)=venta, arranca justo después de la
// fila de encabezado "pais | compra | venta".
export function parseCountryTradeRates(csvText: string): CountryRateRow[] {
  const rows = parseCSV(csvText);
  const result: CountryRateRow[] = [];
  let started = false;

  for (const row of rows) {
    const countryCell = String(row[6] || "").trim();
    const countryNorm = norm(countryCell);

    if (!started) {
      if (countryNorm === "pais" && norm(row[7] || "") === "compra" && norm(row[8] || "") === "venta") {
        started = true;
      }
      continue;
    }

    if (!countryCell) continue;

    const buy = parseRate(row[7]);
    const sell = parseRate(row[8]);

    result.push({
      country: countryCell,
      buy: Number.isFinite(buy) ? buy : null,
      sell: Number.isFinite(sell) ? sell : null,
    });
  }

  return result;
}

export async function fetchCountryTradeRates(): Promise<CountryRateRow[]> {
  const url = RATE_SHEET_CSV_URL + (RATE_SHEET_CSV_URL.includes("?") ? "&" : "?") + "cacheBust=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo leer CSV de tasas: HTTP ${res.status}`);
  const text = await res.text();
  return parseCountryTradeRates(text);
}
