import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export type OpenAICompatibleProviderEnv = {
  readonly MINI_CCODE_API_KEY?: string;
  readonly MINI_CCODE_BASE_URL?: string;
  readonly MINI_CCODE_MODEL?: string;
  readonly MINI_CCODE_MAX_TOKENS?: string;
  readonly MINI_CCODE_TEMPERATURE?: string;
};

export function createOpenAICompatibleProviderFromEnv(
  env: OpenAICompatibleProviderEnv = process.env
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    model: env.MINI_CCODE_MODEL ?? "gpt-4o-mini",
    ...(env.MINI_CCODE_API_KEY === undefined ? {} : { apiKey: env.MINI_CCODE_API_KEY }),
    ...(env.MINI_CCODE_BASE_URL === undefined ? {} : { baseUrl: env.MINI_CCODE_BASE_URL }),
    ...optionalNumberOption("maxTokens", env.MINI_CCODE_MAX_TOKENS),
    ...optionalNumberOption("temperature", env.MINI_CCODE_TEMPERATURE)
  });
}

function optionalNumberOption(
  key: "maxTokens" | "temperature",
  value: string | undefined
): Partial<Record<"maxTokens" | "temperature", number>> {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return {};
  }

  return { [key]: parsed };
}

