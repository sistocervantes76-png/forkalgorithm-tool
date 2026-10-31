import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run worker:dev` serves the API on :8787; Vite proxies to it in dev.
    proxy: { "/api": "http://localhost:8787" },
  },
});
