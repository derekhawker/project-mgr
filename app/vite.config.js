import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export const presentationAliases = {
  "@ui-lib": fileURLToPath(
    new URL("./packages/ui-lib/index.js", import.meta.url),
  ),
};

export default defineConfig({
  plugins: [solid()],
  resolve: { alias: presentationAliases },
  clearScreen: false,
  build: {
    target: "esnext",
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PROJECT_MGR_DEV_PORT ?? 1420),
    strictPort: true,
  },
});
