import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El proxy evita problemas de CORS en desarrollo: el cliente llama a /api y Vite
// lo reenvía al backend Django. En producción (iframe) se usa VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
      },
      // Assets subidos por el master (sprites de símbolos) — mismo origen, sin CORS.
      "/media": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
      },
    },
  },
});
