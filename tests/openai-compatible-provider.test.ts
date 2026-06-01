import { describe, expect, it } from "vitest";

import {
  createOpenAICompatibleProviderFromEnv,
  OpenAICompatibleProvider,
  type ModelStreamEvent
} from "../src/index.js";

type FetchCall = {
  readonly input: RequestInfo | URL;
  readonly init: RequestInit | undefined;
};

async function collectEvents(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function streamResponse(chunks: readonly string[], status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    {
      status,
      headers: { "content-type": "text/event-stream" }
    }
  );
}

function fakeFetchReturning(response: Response, calls: FetchCall[] = []): typeof fetch {
  return (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(response);
  };
}

function sseData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function inputToString(input: RequestInfo | URL | undefined): string | undefined {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input?.url;
}

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  return typeof body === "string" ? body : undefined;
}

describe("OpenAICompatibleProvider", () => {
  it("posts an OpenAI-compatible streaming chat completion request", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(streamResponse(["data: [DONE]\n\n"]), calls),
      maxTokens: 128,
      temperature: 0.2
    });

    await collectEvents(
      provider.stream({
        messages: [{ role: "user", content: "hello" }]
      })
    );

    expect(calls).toHaveLength(1);
    expect(inputToString(calls[0]?.input)).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer test-key"
    });
    expect(JSON.parse(bodyToString(calls[0]?.init?.body) ?? "")).toEqual({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 128,
      temperature: 0.2
    });
  });

  it("sends tool definitions in OpenAI-compatible format", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(streamResponse(["data: [DONE]\n\n"]), calls)
    });

    await collectEvents(
      provider.stream({
        messages: [{ role: "user", content: "use a tool" }],
        tools: [
          {
            name: "echo",
            description: "Return text.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"]
            }
          }
        ]
      })
    );

    expect(JSON.parse(bodyToString(calls[0]?.init?.body) ?? "")).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "echo",
            description: "Return text.",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"]
            }
          }
        }
      ]
    });
  });

  it("serializes assistant tool calls and tool results for follow-up requests", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(streamResponse(["data: [DONE]\n\n"]), calls)
    });

    await collectEvents(
      provider.stream({
        messages: [
          { role: "user", content: "use echo" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
          },
          {
            role: "tool",
            toolCallId: "call_1",
            toolName: "echo",
            content: "hello"
          }
        ]
      })
    );

    const body = JSON.parse(bodyToString(calls[0]?.init?.body) ?? "") as {
      readonly messages: unknown;
    };

    expect(body.messages).toEqual([
      { role: "user", content: "use echo" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "echo", arguments: "{\"text\":\"hello\"}" }
          }
        ]
      },
      { role: "tool", tool_call_id: "call_1", content: "hello" }
    ]);
  });

  it("converts SSE text chunks into stable stream events", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        streamResponse([
          sseData({
            model: "gpt-test",
            choices: [{ delta: { content: "he" }, finish_reason: null }]
          }),
          sseData({
            choices: [{ delta: { content: "llo" }, finish_reason: "stop" }]
          }),
          sseData({
            choices: [],
            usage: { prompt_tokens: 3, completion_tokens: 2 }
          }),
          "data: [DONE]\n\n"
        ])
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      { type: "text_delta", text: "he" },
      { type: "text_delta", text: "llo" },
      {
        type: "response_stop",
        response: {
          content: "hello",
          stopReason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 2 },
          model: "gpt-test"
        }
      }
    ]);
  });

  it("ignores null usage chunks from compatible gateways", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        streamResponse([
          sseData({
            model: "gpt-test",
            choices: [{ delta: { content: "hi" }, finish_reason: "stop" }],
            usage: null
          }),
          "data: [DONE]\n\n"
        ])
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      { type: "text_delta", text: "hi" },
      {
        type: "response_stop",
        response: {
          content: "hi",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "gpt-test"
        }
      }
    ]);
  });

  it("ignores null content deltas from compatible gateways", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        streamResponse([
          sseData({
            choices: [{ delta: { content: null }, finish_reason: null }]
          }),
          sseData({
            model: "gpt-test",
            choices: [{ delta: { content: "hello" }, finish_reason: "stop" }]
          }),
          "data: [DONE]\n\n"
        ])
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      { type: "text_delta", text: "hello" },
      {
        type: "response_stop",
        response: {
          content: "hello",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "gpt-test"
        }
      }
    ]);
  });

  it("accumulates streamed tool call deltas by index", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        streamResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "echo", arguments: "{\"text\"" }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: ":\"hello\"}" } }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }),
          "data: [DONE]\n\n"
        ])
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "response_stop",
        response: {
          content: "",
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
        }
      }
    ]);
  });

  it("reports invalid streamed tool arguments", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        streamResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "echo", arguments: "{\"text\":" }
                    }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }),
          "data: [DONE]\n\n"
        ])
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "error",
        error: {
          code: "invalid_tool_arguments",
          message:
            "OpenAI-compatible provider returned invalid JSON arguments for tool call at index 0."
        }
      }
    ]);
  });

  it("maps HTTP failures into structured stream errors", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(
        new Response(JSON.stringify({ error: { message: "bad model" } }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "error",
        error: {
          code: "http_error",
          message:
            'OpenAI-compatible provider returned HTTP 401: {"error":{"message":"bad model"}}',
          status: 401
        }
      }
    ]);
  });

  it("maps invalid JSON stream chunks into structured errors", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(streamResponse(["data: not-json\n\n"]))
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "error",
        error: {
          code: "invalid_stream",
          message: "OpenAI-compatible provider returned an invalid stream chunk."
        }
      }
    ]);
  });

  it("requires an API key for non-local base URLs", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      fetch: fakeFetchReturning(streamResponse([]), calls)
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(calls).toHaveLength(0);
    expect(events).toEqual([
      {
        type: "error",
        error: {
          code: "missing_api_key",
          message:
            "OpenAI-compatible provider requires an API key unless the base URL is local."
        }
      }
    ]);
  });

  it("allows local base URLs without an API key", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAICompatibleProvider({
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      fetch: fakeFetchReturning(streamResponse(["data: [DONE]\n\n"]), calls)
    });

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(inputToString(calls[0]?.input)).toBe(
      "http://localhost:11434/v1/chat/completions"
    );
    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "response_stop",
        response: {
          content: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 }
        }
      }
    ]);
  });

  it("reports already-aborted requests before calling fetch", async () => {
    const calls: FetchCall[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAICompatibleProvider({
      model: "gpt-test",
      apiKey: "test-key",
      fetch: fakeFetchReturning(streamResponse([]), calls)
    });

    const events = await collectEvents(
      provider.stream({ messages: [], signal: controller.signal })
    );

    expect(calls).toHaveLength(0);
    expect(events).toEqual([
      {
        type: "error",
        error: { code: "aborted", message: "Model request was aborted." }
      }
    ]);
  });

  it("can create a provider from OpenAI-compatible environment variables", () => {
    const provider = createOpenAICompatibleProviderFromEnv({
      MINI_CCODE_API_KEY: "test-key",
      MINI_CCODE_BASE_URL: "http://localhost:11434/v1",
      MINI_CCODE_MODEL: "local-model",
      MINI_CCODE_MAX_TOKENS: "32",
      MINI_CCODE_TEMPERATURE: "0"
    });

    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });
});
