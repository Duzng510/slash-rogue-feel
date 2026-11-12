import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5199,
    strictPort: true,
  },
  build: { target: "es2022", outDir: "dist" },
});
