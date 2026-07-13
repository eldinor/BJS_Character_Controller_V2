import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    outDir: "demo-dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        playground: resolve(import.meta.dirname, "index.html"),
        gameLevel: resolve(import.meta.dirname, "game-level.html"),
      },
    },
  },
});
