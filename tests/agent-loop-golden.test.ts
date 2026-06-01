import { describe, expect, it } from "vitest";

import {
  Agent,
  MockModelProvider,
  ToolRegistry,
  defineTool,
  readOnlyPermissionPolicy,
  type AgentEvent
} from "../src/index.js";

async function transcriptFor(agent: Agent, input: string): Promise<AgentEvent[]> {
  const transcript: AgentEvent[] = [];
  for await (const event of agent.runStream(input)) {
    transcript.push(event);
  }
  return transcript;
}

describe("Agent Loop golden transcripts", () => {
  it("records a text-only successful turn", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([{ type: "response", content: "hi" }])
    });

    await expect(transcriptFor(agent, "hello")).resolves.toEqual([
      { type: "turn_start", input: "hello" },
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "model_request", messages: [{ role: "user", content: "hello" }] },
      { type: "model_response_start" },
      { type: "text_delta", text: "hi" },
      {
        type: "model_response",
        response: {
          content: "hi",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 }
        }
      },
      { type: "message", message: { role: "assistant", content: "hi" } },
      { type: "turn_end", reason: "completed" }
    ]);
  });

  it("records a provider error turn", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "error",
          error: { code: "provider_error", message: "model failed" }
        }
      ])
    });

    await expect(transcriptFor(agent, "fail")).resolves.toEqual([
      { type: "turn_start", input: "fail" },
      { type: "message", message: { role: "user", content: "fail" } },
      { type: "model_request", messages: [{ role: "user", content: "fail" }] },
      { type: "model_response_start" },
      {
        type: "error",
        error: {
          code: "provider_error",
          message: "model failed",
          providerError: { code: "provider_error", message: "model failed" }
        }
      },
      { type: "turn_end", reason: "provider_error" }
    ]);
  });

  it("records tool call, tool result, and follow-up model request", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
        },
        { type: "response", content: "Echo says hello." }
      ]),
      tools: new ToolRegistry([
        defineTool({
          name: "echo",
          description: "Return text.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"]
          },
          execute: input => ({ ok: true, content: String(input.text) })
        })
      ])
    });

    await expect(transcriptFor(agent, "use echo")).resolves.toEqual([
      { type: "turn_start", input: "use echo" },
      { type: "message", message: { role: "user", content: "use echo" } },
      { type: "model_request", messages: [{ role: "user", content: "use echo" }] },
      { type: "model_response_start" },
      {
        type: "model_response",
        response: {
          content: "",
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
        }
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
        }
      },
      {
        type: "tool_call",
        call: { id: "call_1", name: "echo", input: { text: "hello" } }
      },
      {
        type: "tool_result",
        result: {
          callId: "call_1",
          toolName: "echo",
          ok: true,
          content: "hello"
        }
      },
      {
        type: "message",
        message: {
          role: "tool",
          toolCallId: "call_1",
          toolName: "echo",
          content: "hello",
          isError: false
        }
      },
      {
        type: "model_request",
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
      },
      { type: "model_response_start" },
      { type: "text_delta", text: "Echo says hello." },
      {
        type: "model_response",
        response: {
          content: "Echo says hello.",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 }
        }
      },
      {
        type: "message",
        message: { role: "assistant", content: "Echo says hello." }
      },
      { type: "turn_end", reason: "completed" }
    ]);
  });

  it("records permission denied tool results and follow-up model request", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
        },
        { type: "response", content: "I need permission before writing." }
      ]),
      tools: new ToolRegistry([
        defineTool({
          name: "write_note",
          description: "Write text.",
          inputSchema: { type: "object" },
          execute: () => ({ ok: true, content: "wrote" })
        })
      ]),
      permissionPolicy: readOnlyPermissionPolicy()
    });

    await expect(transcriptFor(agent, "write note")).resolves.toEqual([
      { type: "turn_start", input: "write note" },
      { type: "message", message: { role: "user", content: "write note" } },
      { type: "model_request", messages: [{ role: "user", content: "write note" }] },
      { type: "model_response_start" },
      {
        type: "model_response",
        response: {
          content: "",
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
        }
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
        }
      },
      {
        type: "tool_call",
        call: { id: "call_1", name: "write_note", input: {} }
      },
      {
        type: "tool_result",
        result: {
          callId: "call_1",
          toolName: "write_note",
          ok: false,
          error: {
            code: "permission_denied",
            message:
              'Permission denied for tool "write_note": Tool "write_note" is not read-only.'
          }
        }
      },
      {
        type: "message",
        message: {
          role: "tool",
          toolCallId: "call_1",
          toolName: "write_note",
          content:
            'Error(permission_denied): Permission denied for tool "write_note": Tool "write_note" is not read-only.',
          isError: true
        }
      },
      {
        type: "model_request",
        messages: [
          { role: "user", content: "write note" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
          },
          {
            role: "tool",
            toolCallId: "call_1",
            toolName: "write_note",
            content:
              'Error(permission_denied): Permission denied for tool "write_note": Tool "write_note" is not read-only.'
          }
        ]
      },
      { type: "model_response_start" },
      { type: "text_delta", text: "I need permission before writing." },
      {
        type: "model_response",
        response: {
          content: "I need permission before writing.",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 }
        }
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: "I need permission before writing."
        }
      },
      { type: "turn_end", reason: "completed" }
    ]);
  });
});
