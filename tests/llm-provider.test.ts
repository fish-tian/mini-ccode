import { describe, expect, it } from "vitest";

import {
  MockModelProvider,
  ModelProviderError,
  type ModelStreamEvent
} from "../src/index.js";

async function collectEvents(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("MockModelProvider", () => {
  it("returns a fixed complete response with default usage", async () => {
    const provider = new MockModelProvider([{ type: "response", content: "hello" }]);

    await expect(provider.complete({ messages: [] })).resolves.toEqual({
      content: "hello",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 }
    });
  });

  it("preserves custom usage, stop reason, model, and stream deltas", async () => {
    const provider = new MockModelProvider([
      {
        type: "response",
        content: "hello",
        deltas: ["he", "llo"],
        stopReason: "max_tokens",
        usage: { inputTokens: 4, outputTokens: 2 },
        model: "mock-model"
      }
    ]);

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      { type: "text_delta", text: "he" },
      { type: "text_delta", text: "llo" },
      {
        type: "response_stop",
        response: {
          content: "hello",
          stopReason: "max_tokens",
          usage: { inputTokens: 4, outputTokens: 2 },
          model: "mock-model"
        }
      }
    ]);
  });

  it("preserves scripted tool calls on the final response", async () => {
    const provider = new MockModelProvider([
      {
        type: "response",
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
      }
    ]);

    await expect(provider.complete({ messages: [] })).resolves.toEqual({
      content: "",
      stopReason: "tool_use",
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
    });
  });

  it("consumes scripted steps in order", async () => {
    const provider = new MockModelProvider([
      { type: "response", content: "first" },
      { type: "response", content: "second" }
    ]);

    await expect(provider.complete({ messages: [] })).resolves.toMatchObject({
      content: "first"
    });
    await expect(provider.complete({ messages: [] })).resolves.toMatchObject({
      content: "second"
    });
  });

  it("turns exhausted scripts into structured errors", async () => {
    const provider = new MockModelProvider([]);

    await expect(provider.complete({ messages: [] })).rejects.toMatchObject({
      providerError: { code: "script_exhausted" }
    });
  });

  it("streams provider errors as structured events", async () => {
    const provider = new MockModelProvider([
      {
        type: "error",
        error: { code: "provider_error", message: "model failed" }
      }
    ]);

    const events = await collectEvents(provider.stream({ messages: [] }));

    expect(events).toEqual([
      { type: "response_start" },
      {
        type: "error",
        error: { code: "provider_error", message: "model failed" }
      }
    ]);
  });

  it("rejects complete calls when an error event is produced", async () => {
    const provider = new MockModelProvider([
      {
        type: "error",
        error: { code: "provider_error", message: "model failed" }
      }
    ]);

    await expect(provider.complete({ messages: [] })).rejects.toBeInstanceOf(
      ModelProviderError
    );
  });

  it("reports already-aborted requests before starting a response", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockModelProvider([{ type: "response", content: "unused" }]);

    const events = await collectEvents(
      provider.stream({ messages: [], signal: controller.signal })
    );

    expect(events).toEqual([
      {
        type: "error",
        error: { code: "aborted", message: "Model request was aborted." }
      }
    ]);
  });
});
