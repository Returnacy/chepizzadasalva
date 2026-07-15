import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// Removed Replit-specific plugin imports (runtime error modal, cartographer)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  // Use project root as root (previously pointed to non-existent client/ folder)
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Dev-only proxy so the local dev server can talk to prod backends
      // same-origin (no CORS). Not used by `vite build`.
      "/user-svc": {
        target: "https://user.returnacy.app",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/user-svc/, ""),
      },
      "/business-svc": {
        target: "https://fidelity.business.chepizzadasalva.it",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/business-svc/, ""),
      },
      "/api": {
        target: "https://fidelity.business.chepizzadasalva.it",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
