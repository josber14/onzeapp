import type { NextConfig } from "next";

// Next.js bloquea correr 2 "next dev" del mismo proyecto a la vez (aunque
// sea en puertos distintos) porque por defecto ambos comparten el mismo
// directorio de build (.next) y su archivo de bloqueo interno -- confirmado
// en vivo (ago 2026): el puerto 3001 (túnel de Cloudflare, app.onze-pay.com)
// y el puerto 3000 (uso normal) se pisaban constantemente, dejando uno de
// los dos sin poder arrancar. Se separa el directorio de build según el
// puerto (variable NEXT_DEV_DIST_SUFFIX, fijada solo al lanzar el del
// túnel) para que cada instancia tenga su propio bloqueo y puedan correr
// las 2 en simultáneo sin matar una para levantar la otra.
const distSuffix = process.env.NEXT_DEV_DIST_SUFFIX;

const nextConfig: NextConfig = {
  ...(distSuffix ? { distDir: `.next-${distSuffix}` } : {}),
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
