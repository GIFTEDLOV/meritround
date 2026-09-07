import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  envDir: fileURLToPath(new URL("../", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: fileURLToPath(new URL("dist/", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/genlayer-js") || id.includes("node_modules/viem")) {
            return "genlayer-runtime";
          }
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
