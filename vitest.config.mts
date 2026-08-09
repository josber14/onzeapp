import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // sendAndTrack() espera 2-5s "humanos" antes de cada mensaje del bot
    // (más un posible reintento de 3s) -- una prueba con varios mensajes
    // de ida y vuelta puede tardar bastante más que el timeout por defecto
    // de vitest (5s).
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
