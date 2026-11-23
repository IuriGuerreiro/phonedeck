import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  // app/ uses 1420, so this can run alongside it.
  // host: listen on all interfaces so Tailscale (and LAN) devices can reach it.
  // allowedHosts: let Tailscale MagicDNS names (*.ts.net) through Vite's host check.
  server: { port: 1430, strictPort: true, host: true, allowedHosts: [".ts.net"] },
  preview: { port: 1430, strictPort: true, host: true, allowedHosts: [".ts.net"] },
});
