import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const html = readFileSync(htmlPath, "utf-8");
    // Marca de versión = hash del contenido real del archivo (calculado
    // sobre el mismo texto que lee /api/panel-version, ANTES de inyectar
    // este script) -- se actualiza sola con cada deploy, sin que nadie
    // tenga que subir un número a mano. El propio panel la compara contra
    // /api/panel-version cada pocos minutos para recargarse solo si hay
    // una versión más nueva (ver auto-recarga en onze-panel.html). No se
    // usa la fecha de modificación del archivo (fs.stat) porque en Vercel
    // sale fija sin importar el deploy real -- ver el comentario en
    // /api/panel-version/route.ts.
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
    const withVersion = html.replace(
      "<head>",
      `<head>\n  <script>window.__ONZE_PANEL_VERSION = ${JSON.stringify(hash)};</script>`
    );

    return new Response(withVersion, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    return new Response("Panel no encontrado", { status: 500 });
  }
}
