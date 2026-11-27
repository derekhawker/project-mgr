import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import { presentationAliases } from "./vite.config.js";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: presentationAliases,
    dedupe: ["solid-js"],
    conditions: ["browser"],
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/vitestSetup.js"],
    include: ["**/*.vitest.test.js"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
