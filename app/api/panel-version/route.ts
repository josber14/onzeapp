import { statSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

// Endpoint muy liviano (un solo fs.stat, no lee el archivo completo) --
// consultado periódicamente por el propio panel (ver el script de
// auto-recarga en public/onze-panel.html) para saber si hay una versión
// más nueva que la que tiene cargada, sin depender de que alguien se
// acuerde de refrescar la pestaña a mano.
export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const stat = statSync(htmlPath);
    return Response.json(
      { ok: true, mtimeMs: stat.mtimeMs },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
