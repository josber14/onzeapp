import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const htmlPath = join(process.cwd(), "public", "onze-panel.html");
    const html = readFileSync(htmlPath, "utf-8");

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    return new Response("Panel no encontrado", { status: 500 });
  }
}
