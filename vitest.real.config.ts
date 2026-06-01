import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/llm-smoke.real.ts"]
  }
});

