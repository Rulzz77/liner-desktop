import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Mirror Vite's normal desktop target during unit tests. Production and
  // Android builds replace this constant in vite.config.ts.
  define: {
    __LINER_TARGET__: JSON.stringify("desktop"),
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
