import { readFileSync } from "fs";
import { join } from "path";
import { computePanelVersionHash } from "@/lib/panel-version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const html = readFileSync(htmlPath, "utf-8");
    // Marca de versión = mismo hash que calcula /api/panel-version (ver
    // lib/panel-version.ts) -- se actualiza sola con cada deploy real, sin
    // que nadie tenga que subir un número a mano. El propio panel la
    // compara contra /api/panel-version cada pocos minutos para avisar si
    // hay una versión más nueva (ver auto-recarga en
    // public/onze-panel-scripts/part-02.js).
    const hash = computePanelVersionHash();
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
