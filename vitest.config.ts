import path from "node:path";
import { defineConfig } from "vitest/config";

// Only needed because adminAccessControl.test.ts imports actual route.ts
// handler modules (to exercise their real auth-check logic end to end),
// and those files use the "@/*" alias internally — vitest/Vite doesn't read
// tsconfig.json's `paths` on its own, unlike `tsc`/Next's own bundler.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
