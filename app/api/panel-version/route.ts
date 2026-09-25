import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

export const dynamic = "force-dynamic";

// Consultado periódicamente por el propio panel (ver el script de
// auto-recarga en public/onze-panel.html) para saber si hay una versión
// más nueva que la que tiene cargada, sin depender de que alguien se
// acuerde de refrescar la pestaña a mano.
//
// Bug real confirmado en vivo (sep 2026): la primera versión de esto usaba
// la fecha de modificación del archivo (fs.stat) -- en Vercel esa fecha
// sale FIJA (ej. 1540000000000, año 2018) sin importar cuándo se hizo el
// deploy real, probablemente porque el proceso de build normaliza las
// fechas de los archivos estáticos. Con eso, la comparación nunca hubiera
// detectado un deploy nuevo. Se usa un hash del CONTENIDO real del
// archivo en su lugar -- cambia si y solo si el archivo realmente cambió,
// sin depender de ninguna fecha del sistema de archivos.
export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const html = readFileSync(htmlPath, "utf-8");
    const hasher = createHash("sha256").update(html);

    // Sep 2026: el código del panel se partió en archivos aparte (ver
    // public/onze-panel-scripts/, AGENTS.md "Fase 1 -- aligerar el celular")
    // para que el navegador pueda reusar el código ya compilado entre
    // aperturas del panel. Si solo se hasheara onze-panel.html, un cambio
    // futuro en uno de esos archivos .js NUNCA dispararía la auto-recarga
    // -- se incluyen acá también, ordenados por nombre para que el hash sea
    // estable sin importar el orden en que el sistema de archivos los liste.
    const scriptsDir = join(process.cwd(), "public", "onze-panel-scripts");
    const scriptFiles = readdirSync(scriptsDir).filter((f) => f.endsWith(".js")).sort();
    for (const file of scriptFiles) {
      hasher.update(readFileSync(join(scriptsDir, file), "utf-8"));
    }

    const hash = hasher.digest("hex").slice(0, 16);
    return Response.json(
      { ok: true, hash },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
