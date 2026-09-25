import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

// Fuente ÚNICA del hash de versión del panel -- usado por /api/panel (lo
// inyecta como window.__ONZE_PANEL_VERSION) y /api/panel-version (lo que el
// propio panel consulta cada 3 min para saber si hay una versión nueva).
//
// Bug real confirmado en vivo (sep 2026): estas dos rutas tenían cada una
// su PROPIA copia de este cálculo. Cuando se agregó public/onze-panel-scripts/
// (partir el código en archivos aparte) se actualizó el hash de
// /api/panel-version para incluir esos archivos, pero se olvidó actualizar
// /api/panel de la misma forma -- quedó hasheando SOLO onze-panel.html.
// Resultado: los dos hashes nunca volvían a coincidir, así que el panel
// mostraba "hay una versión nueva" TODO el tiempo, incluso recién actualizado,
// sin que hubiera ningún deploy real de por medio. Con un único cálculo acá,
// compartido por las dos rutas, esto no puede volver a desincronizarse.
export function computePanelVersionHash(): string {
  const htmlPath = join(process.cwd(), "public", "onze-panel.html");
  const html = readFileSync(htmlPath, "utf-8");
  const hasher = createHash("sha256").update(html);

  const scriptsDir = join(process.cwd(), "public", "onze-panel-scripts");
  const scriptFiles = readdirSync(scriptsDir).filter((f) => f.endsWith(".js")).sort();
  for (const file of scriptFiles) {
    hasher.update(readFileSync(join(scriptsDir, file), "utf-8"));
  }

  return hasher.digest("hex").slice(0, 16);
}
