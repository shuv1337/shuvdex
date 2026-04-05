import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// SPA fallback for preview mode — serves index.html for client-side routes
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    configurePreviewServer(server) {
      // Return a post-middleware function (runs after built-in static file serving)
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = req.url || "";
          // Skip API routes and files with extensions
          if (
            !url.startsWith("/api") &&
            !url.includes(".") &&
            url !== "/" &&
            req.method === "GET"
          ) {
            // Rewrite to / so Vite serves index.html
            req.url = "/";
          }
          next();
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), spaFallback()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3847",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    allowedHosts: ["shuvdev"],
    // Proxy API requests to the backend (same as dev mode)
    proxy: {
      "/api": {
        target: "http://localhost:3847",
        changeOrigin: true,
      },
    },
  },
});
