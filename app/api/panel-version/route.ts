import { computePanelVersionHash } from "@/lib/panel-version";

export const dynamic = "force-dynamic";

// Consultado periódicamente por el propio panel (ver el script de
// auto-recarga en public/onze-panel-scripts/part-02.js) para saber si hay una
// versión más nueva que la que tiene cargada, sin depender de que alguien se
// acuerde de refrescar la pestaña a mano.
//
// Bug real confirmado en vivo (sep 2026): la primera versión de esto usaba
// la fecha de modificación del archivo (fs.stat) -- en Vercel esa fecha
// sale FIJA (ej. 1540000000000, año 2018) sin importar cuándo se hizo el
// deploy real, probablemente porque el proceso de build normaliza las
// fechas de los archivos estáticos. Se usa un hash del CONTENIDO real en su
// lugar (ver lib/panel-version.ts, compartido con /api/panel para que los
// dos nunca vuelvan a desincronizarse).
export async function GET() {
  try {
    const hash = computePanelVersionHash();
    return Response.json(
      { ok: true, hash },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
