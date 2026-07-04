import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the dashboard calls /api/* on its own origin (5173) and Vite
// forwards to the API (3000). Sidesteps CORS entirely — same pattern as an
// nginx reverse proxy in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
