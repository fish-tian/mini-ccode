import { describe, expect, it, vi } from "vitest";

import {
  createSubAgentTool,
  createToolsForSubAgent,
  buildSubAgentSystemPrompt,
  createTodoState,
  createTodoWriteTool,
  defineTool,
  MockModelProvider,
  readOnlyPermissionPolicy,
  ToolRegistry,
  executeToolCall,
  type Tool
} from "../src/index.js";

function createParentTools(todoState = createTodoState()): readonly Tool[] {
  return [
    createTodoWriteTool(todoState),
    defineTool({
      name: "read_file",
      description: "Read.",
      inputSchema: { type: "object" },
      isReadOnly: true,
      execute: () => ({ ok: true, content: "read" })
    }),
    defineTool({
      name: "write_file",
      description: "Write.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "write" })
    }),
    defineTool({
      name: "powershell",
      description: "Run.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "run" })
    }),
    defineTool({
      name: "agent",
      description: "Nested.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "nested" })
    })
  ];
}

describe("sub-agent", () => {
  it("creates the agent tool with the expected schema", () => {
    const tool = createSubAgentTool({
      provider: new MockModelProvider([]),
      parentTools: []
    });

    expect(tool.name).toBe("agent");
    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.inputSchema.required).toEqual(["description", "prompt"]);
  });

  it("builds ccb-inspired system prompts for general and explore agents", () => {
    const general = buildSubAgentSystemPrompt("general");
    const explore = buildSubAgentSystemPrompt("explore");

    expect(general).toContain("Searching for code, configuration, and patterns");
    expect(general).toContain("Prefer editing existing files over creating new files");
    expect(general).toContain("normal permission policy");
    expect(general).toContain("Do not spawn another agent");

    expect(explore).toContain("Critical read-only rules");
    expect(explore).toContain("Do not create, modify, delete, move, or copy files");
    expect(explore).toContain("Use glob for broad file pattern matching");
    expect(explore).toContain("Use grep for searching file contents");
    expect(explore).toContain("Do not run local commands");
  });

  it("filters general tools by removing only agent", () => {
    const todoState = createTodoState();
    const tools = createToolsForSubAgent(
      {
        description: "implement-auth",
        prompt: "Implement auth.",
        subagentType: "general"
      },
      { parentTools: createParentTools(todoState), todoState }
    );

    expect(tools.map(tool => tool.name)).toEqual([
      "TodoWrite",
      "read_file",
      "write_file",
      "powershell"
    ]);
  });

  it("limits explore tools to read-only file research", () => {
    const tools = createToolsForSubAgent(
      {
        description: "inspect-auth",
        prompt: "Inspect auth.",
        subagentType: "explore"
      },
      { parentTools: createParentTools(), workspaceRoot: process.cwd() }
    );

    expect(tools.map(tool => tool.name)).toEqual(["read_file", "glob", "grep"]);
  });

  it("allows explore but denies general under read-only policy", async () => {
    const tool = createSubAgentTool({
      provider: new MockModelProvider([{ type: "response", content: "done" }]),
      parentTools: []
    });
    const registry = new ToolRegistry([tool]);

    await expect(
      executeToolCall(
        registry,
        {
          id: "call_1",
          name: "agent",
          input: {
            description: "inspect",
            prompt: "Inspect.",
            subagent_type: "explore"
          }
        },
        { permissionPolicy: readOnlyPermissionPolicy() }
      )
    ).resolves.toMatchObject({
      ok: true,
      content: "[Sub-agent completed]\ndone"
    });

    await expect(
      executeToolCall(
        registry,
        {
          id: "call_2",
          name: "agent",
          input: {
            description: "change",
            prompt: "Change files.",
            subagent_type: "general"
          }
        },
        { permissionPolicy: readOnlyPermissionPolicy() }
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "permission_denied" }
    });
  });

  it("forwards child tool events before returning the final result", async () => {
    const events: unknown[] = [];
    const parentTools = [
      defineTool({
        name: "read_file",
        description: "Read.",
        inputSchema: {
          type: "object",
          properties: { file_path: { type: "string" } },
          required: ["file_path"]
        },
        isReadOnly: true,
        execute: () => ({ ok: true, content: "contents" })
      })
    ];
    const tool = createSubAgentTool({
      provider: new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "child_1", name: "read_file", input: { file_path: "a.ts" } }]
        },
        { type: "response", content: "found auth" }
      ]),
      parentTools
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      {
        id: "call_1",
        name: "agent",
        input: {
          description: "inspect-auth",
          prompt: "Inspect auth.",
          subagent_type: "general"
        }
      },
      { emitEvent: event => events.push(event) }
    );

    expect(result).toMatchObject({
      ok: true,
      content: "[Sub-agent completed]\nfound auth"
    });
    expect(events).toContainEqual({
      type: "sub_agent_event",
      description: "inspect-auth",
      event: {
        type: "tool_call",
        call: { id: "child_1", name: "read_file", input: { file_path: "a.ts" } }
      }
    });
  });

  it("writes general child todos into a sub-agent owner", async () => {
    const todoState = createTodoState();
    const tools = createToolsForSubAgent(
      {
        description: "implement auth",
        prompt: "Track work.",
        subagentType: "general"
      },
      { parentTools: createParentTools(todoState), todoState }
    );
    const todo = tools.find(tool => tool.name === "TodoWrite");
    expect(todo).toBeDefined();

    await todo!.execute(
      {
        todos: [
          {
            content: "Inspect auth",
            activeForm: "Inspecting auth",
            status: "in_progress"
          }
        ]
      },
      {}
    );

    expect(todoState.getTodos("main")).toEqual([]);
    expect(todoState.getTodos("subagent:implement-auth")).toEqual([
      {
        content: "Inspect auth",
        activeForm: "Inspecting auth",
        status: "in_progress"
      }
    ]);
  });

  it("returns invalid_input for incomplete agent input", async () => {
    const execute = vi.fn();
    const tool = createSubAgentTool({
      provider: new MockModelProvider([]),
      parentTools: []
    });

    await expect(
      executeToolCall(new ToolRegistry([tool]), {
        id: "call_1",
        name: "agent",
        input: { description: "", prompt: "Do it." }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
