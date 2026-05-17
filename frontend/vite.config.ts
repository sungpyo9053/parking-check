import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_BACKEND_BASE_URL || "http://localhost:8000";
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "주차될까",
          short_name: "주차될까",
          description: "목적지 주차 가능성을 먼저 확인합니다.",
          theme_color: "#0b6cff",
          background_color: "#ffffff",
          display: "standalone",
          start_url: "/",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }
          ]
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: backend, changeOrigin: true }
      }
    }
  };
});
