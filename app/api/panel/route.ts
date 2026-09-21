import { readFileSync, statSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const html = readFileSync(htmlPath, "utf-8");
    // Marca de versión = fecha real de modificación del archivo -- se
    // actualiza sola con cada deploy, sin que nadie tenga que acordarse de
    // subir un número a mano. El propio panel la compara contra
    // /api/panel-version cada pocos minutos para recargarse solo si hay
    // una versión más nueva (ver auto-recarga en onze-panel.html).
    const mtimeMs = statSync(htmlPath).mtimeMs;
    const withVersion = html.replace(
      "<head>",
      `<head>\n  <script>window.__ONZE_PANEL_VERSION = ${mtimeMs};</script>`
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
