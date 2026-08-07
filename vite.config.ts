import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative assets work on both a project Pages URL and a custom domain.
  base: "./",
  plugins: [react()],
  server: { host: "0.0.0.0" },
  build: { outDir: "dist", sourcemap: true },
});
