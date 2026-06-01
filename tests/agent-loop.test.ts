import { describe, expect, it, vi } from "vitest";

import {
  Agent,
  createToolNamePermissionPolicy,
  MockModelProvider,
  ToolRegistry,
  createTodoState,
  createTodoWriteTool,
  defineTool,
  readOnlyPermissionPolicy,
  type LanguageModelProvider,
  type AgentMessage,
  type ContextManager,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent
} from "../src/index.js";

function createEchoRegistry(): ToolRegistry {
  return new ToolRegistry([
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
  ]);
}

async function collectAgentEvents(agent: Agent, input: string): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of agent.runStream(input)) {
    events.push(event);
  }
  return events;
}

class CapturingProvider extends MockModelProvider {
  readonly requests: ModelRequest[] = [];

  override stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    return super.stream(request);
  }
}

class EmptyStreamProvider implements LanguageModelProvider {
  complete(): Promise<ModelResponse> {
    return Promise.reject(new Error("not used"));
  }

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    yield* [];
  }
}

describe("Agent", () => {
  it("runs a text-only turn and stores user and assistant messages", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([{ type: "response", content: "hello back" }])
    });

    await expect(agent.run("hello")).resolves.toEqual({
      content: "hello back",
      stopReason: "completed",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hello back" }
      ]
    });
  });

  it("streams stable events for a successful turn", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        { type: "response", content: "hello back", deltas: ["hello", " back"] }
      ])
    });

    await expect(collectAgentEvents(agent, "hello")).resolves.toEqual([
      { type: "turn_start", input: "hello" },
      { type: "message", message: { role: "user", content: "hello" } },
      {
        type: "model_request",
        messages: [{ role: "user", content: "hello" }]
      },
      { type: "model_response_start" },
      { type: "text_delta", text: "hello" },
      { type: "text_delta", text: " back" },
      {
        type: "model_response",
        response: {
          content: "hello back",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 }
        }
      },
      { type: "message", message: { role: "assistant", content: "hello back" } },
      { type: "turn_end", reason: "completed" }
    ]);
  });

  it("sends system prompt and initial messages to the provider without storing system prompt", async () => {
    const provider = new CapturingProvider([{ type: "response", content: "next" }]);
    const agent = new Agent({
      provider,
      systemPrompt: "You are mini-ccode.",
      initialMessages: [{ role: "assistant", content: "Earlier answer." }]
    });

    await agent.run("continue");

    expect(provider.requests[0]?.messages).toEqual([
      { role: "system", content: "You are mini-ccode." },
      { role: "assistant", content: "Earlier answer." },
      { role: "user", content: "continue" }
    ]);
    expect(agent.getMessages()).toEqual([
      { role: "assistant", content: "Earlier answer." },
      { role: "user", content: "continue" },
      { role: "assistant", content: "next" }
    ]);
  });

  it("sends context messages to the provider without storing them in history", async () => {
    const provider = new CapturingProvider([{ type: "response", content: "next" }]);
    const agent = new Agent({
      provider,
      systemPrompt: "You are mini-ccode.",
      contextMessages: [{ role: "user", content: "<project-instructions>Rules</project-instructions>" }]
    });

    await agent.run("continue");

    expect(provider.requests[0]?.messages).toEqual([
      { role: "system", content: "You are mini-ccode." },
      { role: "user", content: "<project-instructions>Rules</project-instructions>" },
      { role: "user", content: "continue" }
    ]);
    expect(agent.getMessages()).toEqual([
      { role: "user", content: "continue" },
      { role: "assistant", content: "next" }
    ]);
  });

  it("executes a fake tool and continues to a final model response", async () => {
    const provider = new CapturingProvider([
      {
        type: "response",
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "call_1", name: "echo", input: { text: "hello" } }]
      },
      { type: "response", content: "Echo says hello." }
    ]);
    const agent = new Agent({ provider, tools: createEchoRegistry() });

    await expect(agent.run("use echo")).resolves.toEqual({
      content: "Echo says hello.",
      stopReason: "completed",
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
          content: "hello",
          isError: false
        },
        { role: "assistant", content: "Echo says hello." }
      ]
    });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.tools).toEqual([
      {
        name: "echo",
        description: "Return text.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        }
      }
    ]);
    expect(provider.requests[1]?.messages).toEqual([
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
    ]);
  });

  it("emits todo updates after TodoWrite succeeds", async () => {
    const todoState = createTodoState();
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "TodoWrite",
              input: {
                todos: [
                  {
                    content: "Run tests",
                    activeForm: "Running tests",
                    status: "in_progress"
                  }
                ]
              }
            }
          ]
        },
        { type: "response", content: "Working through the list." }
      ]),
      tools: new ToolRegistry([createTodoWriteTool(todoState)]),
      todoState
    });

    await expect(collectAgentEvents(agent, "track progress")).resolves.toContainEqual({
      type: "todo_updated",
      ownerId: "main",
      todos: [
        {
          content: "Run tests",
          activeForm: "Running tests",
          status: "in_progress"
        }
      ]
    });
    expect(agent.getTodos()).toEqual([
      {
        content: "Run tests",
        activeForm: "Running tests",
        status: "in_progress"
      }
    ]);
  });

  it("restores todos from initial messages when no todo state is provided", () => {
    const agent = new Agent({
      provider: new MockModelProvider([]),
      initialMessages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "TodoWrite",
              input: {
                todos: [
                  {
                    content: "Resume task",
                    activeForm: "Resuming task",
                    status: "pending"
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(agent.getTodos()).toEqual([
      {
        content: "Resume task",
        activeForm: "Resuming task",
        status: "pending"
      }
    ]);
  });

  it("turns unknown tools into tool results and lets the model continue", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "missing", input: {} }]
        },
        { type: "response", content: "I could not use that tool." }
      ])
    });

    await expect(agent.run("use missing")).resolves.toMatchObject({
      content: "I could not use that tool.",
      stopReason: "completed",
      messages: [
        { role: "user", content: "use missing" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "missing", input: {} }]
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "missing",
          isError: true
        },
        { role: "assistant", content: "I could not use that tool." }
      ]
    });
  });

  it("does not execute tools with invalid input and continues", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tools = new ToolRegistry([
      defineTool({
        name: "typed",
        description: "Requires text.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        },
        execute
      })
    ]);
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "typed", input: { text: false } }]
        },
        { type: "response", content: "The tool input was wrong." }
      ]),
      tools
    });

    await expect(agent.run("bad tool input")).resolves.toMatchObject({
      content: "The tool input was wrong.",
      stopReason: "completed",
      messages: [
        { role: "user", content: "bad tool input" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "typed", input: { text: false } }]
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "typed",
          isError: true
        },
        { role: "assistant", content: "The tool input was wrong." }
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns thrown tool errors into tool result messages", async () => {
    const tools = new ToolRegistry([
      defineTool({
        name: "thrower",
        description: "Throws.",
        inputSchema: { type: "object" },
        execute: () => {
          throw new Error("boom");
        }
      })
    ]);
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "thrower", input: {} }]
        },
        { type: "response", content: "The tool failed." }
      ]),
      tools
    });

    await agent.run("throw");

    expect(agent.getMessages()[2]).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "thrower",
      content: "Error(execution_error): boom",
      isError: true
    });
  });

  it("turns permission denials into tool result messages and continues", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "should not run" }));
    const tools = new ToolRegistry([
      defineTool({
        name: "write_note",
        description: "Writes a note.",
        inputSchema: { type: "object" },
        execute
      })
    ]);
    const provider = new CapturingProvider([
      {
        type: "response",
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
      },
      { type: "response", content: "I need permission before writing." }
    ]);
    const agent = new Agent({
      provider,
      tools,
      permissionPolicy: readOnlyPermissionPolicy()
    });

    await expect(agent.run("write a note")).resolves.toMatchObject({
      content: "I need permission before writing.",
      stopReason: "completed",
      messages: [
        { role: "user", content: "write a note" },
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
            'Error(permission_denied): Permission denied for tool "write_note": Tool "write_note" is not read-only.',
          isError: true
        },
        { role: "assistant", content: "I need permission before writing." }
      ]
    });
    expect(execute).not.toHaveBeenCalled();
    expect(provider.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "write_note",
      content:
        'Error(permission_denied): Permission denied for tool "write_note": Tool "write_note" is not read-only.'
    });
  });

  it("executes an asked tool after an approval callback allows it", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "wrote" }));
    const tools = new ToolRegistry([
      defineTool({
        name: "write_note",
        description: "Writes a note.",
        inputSchema: { type: "object" },
        execute
      })
    ]);
    const provider = new CapturingProvider([
      {
        type: "response",
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "call_1", name: "write_note", input: {} }]
      },
      { type: "response", content: "Write completed." }
    ]);
    const agent = new Agent({
      provider,
      tools,
      permissionPolicy: createToolNamePermissionPolicy({ ask: ["write_note"] }),
      requestPermission: () => Promise.resolve({ behavior: "allow", scope: "once" })
    });

    await expect(agent.run("write a note")).resolves.toMatchObject({
      content: "Write completed.",
      messages: [
        { role: "user", content: "write a note" },
        { role: "assistant", content: "" },
        { role: "tool", toolName: "write_note", content: "wrote", isError: false },
        { role: "assistant", content: "Write completed." }
      ]
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(provider.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "write_note",
      content: "wrote"
    });
  });

  it("stops repeated tool loops at maxTurns", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "one" } }]
        },
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_2", name: "echo", input: { text: "two" } }]
        }
      ]),
      tools: createEchoRegistry(),
      maxTurns: 1
    });

    await expect(collectAgentEvents(agent, "loop")).resolves.toContainEqual({
      type: "turn_end",
      reason: "max_turns"
    });
    expect(agent.getMessages()).toHaveLength(3);
  });

  it("allows multiple tool loops by default", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "echo", input: { text: "one" } }]
        },
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_2", name: "echo", input: { text: "two" } }]
        },
        { type: "response", content: "done" }
      ]),
      tools: createEchoRegistry()
    });

    await expect(agent.run("loop twice")).resolves.toMatchObject({
      content: "done",
      stopReason: "completed"
    });
    expect(agent.getMessages()).toHaveLength(6);
  });

  it("uses fifty tool loops as the default maxTurns", async () => {
    const repeatedToolResponses = Array.from({ length: 51 }, (_, index) => ({
      type: "response" as const,
      content: "",
      stopReason: "tool_use" as const,
      toolCalls: [
        {
          id: `call_${index + 1}`,
          name: "echo",
          input: { text: String(index + 1) }
        }
      ]
    }));
    const agent = new Agent({
      provider: new MockModelProvider(repeatedToolResponses),
      tools: createEchoRegistry()
    });

    await expect(agent.run("loop until default cap")).resolves.toMatchObject({
      content: "",
      stopReason: "max_turns"
    });
    expect(agent.getMessages()).toHaveLength(101);
  });

  it("returns message snapshots and can reset history", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([{ type: "response", content: "reply" }])
    });

    await agent.run("hello");
    const snapshot = agent.getMessages() as { role: "user" | "assistant"; content: string }[];
    snapshot.push({ role: "user", content: "mutated" });

    expect(agent.getMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply" }
    ]);

    agent.reset();
    expect(agent.getMessages()).toEqual([]);
  });

  it("maps provider errors without appending assistant messages", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([
        {
          type: "error",
          error: { code: "provider_error", message: "model failed" }
        }
      ])
    });

    await expect(collectAgentEvents(agent, "fail")).resolves.toEqual([
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
    expect(agent.getMessages()).toEqual([{ role: "user", content: "fail" }]);
  });

  it("maps provider aborts to aborted turns", async () => {
    const agent = new Agent({
      provider: new MockModelProvider([{ type: "response", content: "unused" }])
    });
    const controller = new AbortController();
    controller.abort();

    await expect(agent.run("stop", { signal: controller.signal })).resolves.toMatchObject({
      content: "",
      stopReason: "aborted",
      messages: [{ role: "user", content: "stop" }]
    });
  });

  it("does not call the provider when maxTurns is zero", async () => {
    const provider = new CapturingProvider([{ type: "response", content: "unused" }]);
    const agent = new Agent({ provider, maxTurns: 0 });

    await expect(collectAgentEvents(agent, "hello")).resolves.toEqual([
      { type: "turn_start", input: "hello" },
      { type: "message", message: { role: "user", content: "hello" } },
      {
        type: "error",
        error: {
          code: "max_turns",
          message: "Agent reached the maximum number of turns before calling the model."
        }
      },
      { type: "turn_end", reason: "max_turns" }
    ]);
    expect(provider.requests).toEqual([]);
  });

  it("reports streams that end without a final response", async () => {
    const agent = new Agent({ provider: new EmptyStreamProvider() });

    await expect(collectAgentEvents(agent, "hello")).resolves.toEqual([
      { type: "turn_start", input: "hello" },
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "model_request", messages: [{ role: "user", content: "hello" }] },
      {
        type: "error",
        error: {
          code: "provider_error",
          message: "Model stream ended without a final response."
        }
      },
      { type: "turn_end", reason: "provider_error" }
    ]);
  });

  it("runs automatic context compaction before the provider request", async () => {
    const provider = new CapturingProvider([{ type: "response", content: "after compact" }]);
    const contextManager: ContextManager = {
      compact: () => Promise.resolve(undefined),
      compactIfNeeded: vi.fn((messages: readonly AgentMessage[]) =>
        Promise.resolve({
          trigger: "automatic" as const,
          messages: [{ role: "user" as const, content: "summary" }, messages.at(-1)!],
          estimatedTokensBefore: 1000,
          estimatedTokensAfter: 20,
          compactedToolResultCount: 0,
          compactedSegmentCount: 1
        })
      )
    };
    const agent = new Agent({
      provider,
      contextManager,
      initialMessages: [{ role: "assistant", content: "old answer" }]
    });

    const events = await collectAgentEvents(agent, "continue");

    expect(events).toContainEqual({
      type: "context_compacted",
      result: {
        trigger: "automatic",
        messages: [
          { role: "user", content: "summary" },
          { role: "user", content: "continue" }
        ],
        estimatedTokensBefore: 1000,
        estimatedTokensAfter: 20,
        compactedToolResultCount: 0,
        compactedSegmentCount: 1
      }
    });
    expect(provider.requests[0]?.messages).toEqual([
      { role: "user", content: "summary" },
      { role: "user", content: "continue" }
    ]);
  });

  it("stops with context_error when automatic compaction fails", async () => {
    const provider = new CapturingProvider([{ type: "response", content: "unused" }]);
    const contextManager: ContextManager = {
      compact: () => Promise.resolve(undefined),
      compactIfNeeded: () => Promise.reject(new Error("compact failed"))
    };
    const agent = new Agent({ provider, contextManager });

    await expect(collectAgentEvents(agent, "hello")).resolves.toEqual([
      { type: "turn_start", input: "hello" },
      { type: "message", message: { role: "user", content: "hello" } },
      {
        type: "error",
        error: {
          code: "context_error",
          message: "compact failed"
        }
      },
      { type: "turn_end", reason: "context_error" }
    ]);
    expect(provider.requests).toEqual([]);
  });
});
