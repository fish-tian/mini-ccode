import {
  createOpenAICompatibleProviderFromEnv,
  ModelProviderError
} from "../src/index.js";

const prompt =
  process.env.MINI_CCODE_SMOKE_PROMPT ??
  "Reply with a short sentence confirming that the mini-ccode LLM smoke test works.";

const provider = createOpenAICompatibleProviderFromEnv();

try {
  const response = await provider.complete({
    messages: [{ role: "user", content: prompt }]
  });

  if (response.content.trim().length === 0) {
    console.error("LLM smoke test failed: provider returned empty content.");
    process.exitCode = 1;
  } else {
    console.log("LLM smoke test passed.");
    console.log(`Model: ${response.model ?? process.env.MINI_CCODE_MODEL ?? "unknown"}`);
    console.log(`Stop reason: ${response.stopReason}`);
    console.log(
      `Usage: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`
    );
    console.log("Response:");
    console.log(response.content);
  }
} catch (error) {
  console.error("LLM smoke test failed.");

  if (error instanceof ModelProviderError) {
    console.error(`Provider error: ${error.providerError.code}`);
    console.error(error.providerError.message);
    if (error.providerError.status !== undefined) {
      console.error(`HTTP status: ${error.providerError.status}`);
    }
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  console.error("");
  console.error("Set these environment variables before running a real smoke test:");
  console.error("- MINI_CCODE_API_KEY");
  console.error("- MINI_CCODE_MODEL");
  console.error("- MINI_CCODE_BASE_URL, optional for OpenAI-compatible gateways");
  process.exitCode = 1;
}

