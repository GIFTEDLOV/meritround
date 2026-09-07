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
  },
});
