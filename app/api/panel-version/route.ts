import { readFileSync } from "fs";
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
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
    return Response.json(
      { ok: true, hash },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
