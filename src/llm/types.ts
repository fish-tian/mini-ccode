export type ModelRole = "system" | "user" | "assistant" | "tool";

export type ModelToolSchemaProperty =
  | { readonly type: "string"; readonly description?: string }
  | { readonly type: "number"; readonly description?: string }
  | { readonly type: "boolean"; readonly description?: string }
  | {
      readonly type: "array";
      readonly items?: ModelToolSchemaProperty;
      readonly description?: string;
    }
  | {
      readonly type: "object";
      readonly properties?: Readonly<Record<string, ModelToolSchemaProperty>>;
      readonly required?: readonly string[];
      readonly description?: string;
    };

export type ModelToolInputSchema = {
  readonly type: "object";
  readonly properties?: Readonly<Record<string, ModelToolSchemaProperty>>;
  readonly required?: readonly string[];
};

export type ModelToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ModelToolInputSchema;
};

export type ModelUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type ModelToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type ModelTextMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type ModelAssistantToolCallMessage = {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
};

export type ModelToolResultMessage = {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string;
};

export type ModelMessage =
  | ModelTextMessage
  | ModelAssistantToolCallMessage
  | ModelToolResultMessage;

export type ModelStopReason = "end_turn" | "max_tokens" | "tool_use" | "error";

export type ModelResponse = {
  readonly content: string;
  readonly stopReason: ModelStopReason;
  readonly usage: ModelUsage;
  readonly model?: string;
  readonly toolCalls?: readonly ModelToolCall[];
};

export type ProviderError = {
  readonly code:
    | "provider_error"
    | "aborted"
    | "script_exhausted"
    | "missing_api_key"
    | "http_error"
    | "invalid_stream"
    | "invalid_tool_arguments";
  readonly message: string;
  readonly status?: number;
};

export type ModelStreamEvent =
  | { readonly type: "response_start" }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "response_stop"; readonly response: ModelResponse }
  | { readonly type: "error"; readonly error: ProviderError };

export type ModelRequest = {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly signal?: AbortSignal;
};

export interface LanguageModelProvider {
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export class ModelProviderError extends Error {
  readonly providerError: ProviderError;

  constructor(providerError: ProviderError) {
    super(providerError.message);
    this.name = "ModelProviderError";
    this.providerError = providerError;
  }
}

export async function collectModelResponse(
  stream: AsyncIterable<ModelStreamEvent>
): Promise<ModelResponse> {
  for await (const event of stream) {
    if (event.type === "error") {
      throw new ModelProviderError(event.error);
    }

    if (event.type === "response_stop") {
      return event.response;
    }
  }

  throw new ModelProviderError({
    code: "provider_error",
    message: "Model stream ended without a final response."
  });
}

export function abortedProviderError(): ProviderError {
  return {
    code: "aborted",
    message: "Model request was aborted."
  };
}
