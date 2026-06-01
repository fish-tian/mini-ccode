import {
  abortedProviderError,
  collectModelResponse,
  type LanguageModelProvider,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelStopReason,
  type ModelStreamEvent,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelUsage,
  type ProviderError
} from "./types.js";

export type OpenAICompatibleProviderOptions = {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly fetch?: typeof fetch;
};

type ChatCompletionChunk = {
  readonly model?: string;
  readonly choices?: readonly ChatCompletionChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  } | null;
};

type ChatCompletionChoice = {
  readonly delta?: {
    readonly content?: string | null;
    readonly tool_calls?: readonly ChatCompletionToolCallDelta[];
  };
  readonly finish_reason?: string | null;
};

type ChatCompletionToolCallDelta = {
  readonly index: number;
  readonly id?: string;
  readonly type?: "function";
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
};

type StreamState = {
  content: string;
  usage: ModelUsage;
  stopReason: ModelStopReason;
  model?: string;
  toolCallsByIndex: Map<number, PartialToolCall>;
};

type PartialToolCall = {
  id: string;
  name: string;
  argumentsText: string;
};

const defaultBaseUrl = "https://api.openai.com/v1";

export class OpenAICompatibleProvider implements LanguageModelProvider {
  readonly #model: string;
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #temperature: number | undefined;
  readonly #maxTokens: number | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.#model = options.model;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.#temperature = options.temperature;
    this.#maxTokens = options.maxTokens;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return collectModelResponse(this.stream(request));
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (request.signal?.aborted) {
      yield { type: "error", error: abortedProviderError() };
      return;
    }

    const validationError = this.#validate();
    if (validationError !== undefined) {
      yield { type: "error", error: validationError };
      return;
    }

    yield { type: "response_start" };

    const response = await this.#postChatCompletion(request);
    if (!response.ok) {
      const responseText = await readErrorResponseText(response);
      yield {
        type: "error",
        error: {
          code: "http_error",
          message:
            responseText.length === 0
              ? `OpenAI-compatible provider returned HTTP ${response.status}.`
              : `OpenAI-compatible provider returned HTTP ${response.status}: ${responseText}`,
          status: response.status
        }
      };
      return;
    }

    if (response.body === null) {
      yield {
        type: "error",
        error: {
          code: "invalid_stream",
          message: "OpenAI-compatible provider returned an empty response body."
        }
      };
      return;
    }

    const state: StreamState = {
      content: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn",
      toolCallsByIndex: new Map()
    };

    for await (const data of readServerSentEventData(response.body, request.signal)) {
      if (request.signal?.aborted) {
        yield { type: "error", error: abortedProviderError() };
        return;
      }

      if (data === "[DONE]") {
        break;
      }

      const chunk = parseChatCompletionChunk(data);
      if (chunk === undefined) {
        yield {
          type: "error",
          error: {
            code: "invalid_stream",
            message: "OpenAI-compatible provider returned an invalid stream chunk."
          }
        };
        return;
      }

      if (chunk.model !== undefined) {
        state.model = chunk.model;
      }

      if (chunk.usage !== undefined && chunk.usage !== null) {
        state.usage = {
          inputTokens: chunk.usage.prompt_tokens ?? state.usage.inputTokens,
          outputTokens: chunk.usage.completion_tokens ?? state.usage.outputTokens
        };
      }

      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        state.content += text;
        yield { type: "text_delta", text };
      }

      for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
        accumulateToolCallDelta(state.toolCallsByIndex, toolCallDelta);
      }

      if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
        state.stopReason = mapFinishReason(choice.finish_reason);
      }
    }

    const toolCalls = parseAccumulatedToolCalls(state.toolCallsByIndex);
    if (!toolCalls.ok) {
      yield { type: "error", error: toolCalls.error };
      return;
    }

    yield {
      type: "response_stop",
      response: {
        content: state.content,
        stopReason: state.stopReason,
        usage: state.usage,
        ...(state.model === undefined ? {} : { model: state.model }),
        ...(toolCalls.value.length === 0 ? {} : { toolCalls: toolCalls.value })
      }
    };
  }

  #validate(): ProviderError | undefined {
    if (this.#model.trim().length === 0) {
      return {
        code: "provider_error",
        message: "OpenAI-compatible provider requires a model name."
      };
    }

    if (this.#apiKey === undefined && !isLocalBaseUrl(this.#baseUrl)) {
      return {
        code: "missing_api_key",
        message:
          "OpenAI-compatible provider requires an API key unless the base URL is local."
      };
    }

    return undefined;
  }

  async #postChatCompletion(request: ModelRequest): Promise<Response> {
    return this.#fetch(this.#chatCompletionsUrl(), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(this.#requestBody(request)),
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
  }

  #chatCompletionsUrl(): string {
    return `${this.#baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  #headers(): HeadersInit {
    return {
      "content-type": "application/json",
      ...(this.#apiKey === undefined ? {} : { authorization: `Bearer ${this.#apiKey}` })
    };
  }

  #requestBody(request: ModelRequest): Record<string, unknown> {
    return {
      model: this.#model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.tools === undefined || request.tools.length === 0
        ? {}
        : { tools: request.tools.map(toOpenAITool) }),
      ...(this.#temperature === undefined ? {} : { temperature: this.#temperature }),
      ...(this.#maxTokens === undefined ? {} : { max_tokens: this.#maxTokens })
    };
  }
}

async function readErrorResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  if (message.role === "assistant" && "toolCalls" in message) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input)
        }
      }))
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function toOpenAITool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  };
}

function accumulateToolCallDelta(
  toolCallsByIndex: Map<number, PartialToolCall>,
  delta: ChatCompletionToolCallDelta
): void {
  const current = toolCallsByIndex.get(delta.index) ?? {
    id: "",
    name: "",
    argumentsText: ""
  };

  toolCallsByIndex.set(delta.index, {
    id: delta.id ?? current.id,
    name: delta.function?.name ?? current.name,
    argumentsText: current.argumentsText + (delta.function?.arguments ?? "")
  });
}

function parseAccumulatedToolCalls(
  toolCallsByIndex: Map<number, PartialToolCall>
):
  | { readonly ok: true; readonly value: readonly ModelToolCall[] }
  | { readonly ok: false; readonly error: ProviderError } {
  const calls: ModelToolCall[] = [];

  for (const [index, call] of [...toolCallsByIndex.entries()].sort(
    ([left], [right]) => left - right
  )) {
    let input: unknown;
    try {
      input = call.argumentsText.length === 0 ? {} : JSON.parse(call.argumentsText);
    } catch {
      return {
        ok: false,
        error: {
          code: "invalid_tool_arguments",
          message: `OpenAI-compatible provider returned invalid JSON arguments for tool call at index ${index}.`
        }
      };
    }

    if (!isRecord(input)) {
      return {
        ok: false,
        error: {
          code: "invalid_tool_arguments",
          message: `OpenAI-compatible provider returned non-object arguments for tool call at index ${index}.`
        }
      };
    }

    calls.push({
      id: call.id.length > 0 ? call.id : `call_${index}`,
      name: call.name,
      input
    });
  }

  return { ok: true, value: calls };
}

async function* readServerSentEventData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = dataFromSseLine(line);
        if (data !== undefined) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const trailingData = dataFromSseLine(buffer);
    if (trailingData !== undefined) {
      yield trailingData;
    }
  } finally {
    reader.releaseLock();
  }
}

function dataFromSseLine(line: string): string | undefined {
  if (!line.startsWith("data:")) {
    return undefined;
  }

  return line.slice("data:".length).trimStart();
}

function parseChatCompletionChunk(data: string): ChatCompletionChunk | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isChatCompletionChunk(parsed)) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatCompletionChunk(value: unknown): value is ChatCompletionChunk {
  return isRecord(value);
}

function mapFinishReason(reason: string): ModelStopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return "error";
  }
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}
