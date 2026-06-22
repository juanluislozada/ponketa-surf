import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proyecto plano (sin carpetas src/public) para subir fácil a GitHub.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
});
