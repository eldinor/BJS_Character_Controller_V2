import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "litecc",
    },
    sourcemap: true,
    rollupOptions: {
      external: ["@babylonjs/lite", "@babylonjs/havok"],
    },
  },
});
