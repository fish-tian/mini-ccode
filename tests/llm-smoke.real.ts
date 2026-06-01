import { describe, expect, it } from "vitest";

import { createOpenAICompatibleProviderFromEnv } from "../src/index.js";

describe("real LLM smoke", () => {
  it(
    "calls the configured OpenAI-compatible provider and returns text",
    async () => {
      expect(process.env.MINI_CCODE_API_KEY, "MINI_CCODE_API_KEY must be set").toBeTruthy();
      expect(process.env.MINI_CCODE_MODEL, "MINI_CCODE_MODEL must be set").toBeTruthy();

      const provider = createOpenAICompatibleProviderFromEnv();
      const response = await provider.complete({
        messages: [
          {
            role: "user",
            content:
              "Reply with exactly one short sentence confirming the mini-ccode real LLM test works."
          }
        ]
      });

      expect(response.content.trim().length).toBeGreaterThan(0);
      expect(response.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(response.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(response.stopReason).toBe("end_turn");
    },
    60_000
  );
});

