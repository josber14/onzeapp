import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // El túnel de Cloudflare expone el servidor de desarrollo local en
  // app.onze-pay.com — sin esto, Next.js bloquea por seguridad las
  // conexiones de hot-reload que llegan desde un dominio que no es
  // localhost, y eso rompe la parte interactiva de la página (ej. el login
  // se queda pegado en el paso del correo, nunca avanza a la clave).
  allowedDevOrigins: ["app.onze-pay.com"],
};

export default nextConfig;
