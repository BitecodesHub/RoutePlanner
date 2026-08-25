import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

/** Live external-service integration tests (Resend). Requires real secrets. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
