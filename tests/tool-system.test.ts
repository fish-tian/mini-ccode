import { describe, expect, test, vi } from "vitest";
import {
  createToolNamePermissionPolicy,
  readOnlyPermissionPolicy
} from "../src/permission/index.js";
import {
  ToolRegistry,
  defineTool,
  executeToolCall,
  validateToolInput,
  type Tool
} from "../src/tools/index.js";

function createEchoTool(): Tool {
  return defineTool({
    name: "echo",
    aliases: ["repeat"],
    description: "Return the input text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: input => ({
      ok: true,
      content: String(input.text)
    })
  });
}

describe("defineTool", () => {
  test("fills conservative behavior defaults", () => {
    const tool = defineTool({
      name: "noop",
      description: "A no-op tool.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "ok" })
    });

    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
  });

  test("preserves explicit behavior flags", () => {
    const tool = createEchoTool();

    expect(tool.isReadOnly).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
  });
});

describe("ToolRegistry", () => {
  test("finds tools by name and alias", () => {
    const registry = new ToolRegistry([createEchoTool()]);

    expect(registry.get("echo")?.name).toBe("echo");
    expect(registry.get("repeat")?.name).toBe("echo");
  });

  test("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  test("rejects duplicate names", () => {
    const first = createEchoTool();
    const second = defineTool({
      name: "echo",
      description: "Duplicate.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "ok" })
    });

    expect(() => new ToolRegistry([first, second])).toThrow(/conflict/);
  });

  test("rejects alias conflicts", () => {
    const first = createEchoTool();
    const second = defineTool({
      name: "other",
      aliases: ["repeat"],
      description: "Alias conflict.",
      inputSchema: { type: "object" },
      execute: () => ({ ok: true, content: "ok" })
    });

    expect(() => new ToolRegistry([first, second])).toThrow(/conflict/);
  });

  test("list returns a copy", () => {
    const registry = new ToolRegistry([createEchoTool()]);
    const listed = registry.list() as Tool[];

    listed.pop();

    expect(registry.list()).toHaveLength(1);
  });
});

describe("validateToolInput", () => {
  const schema = {
    type: "object" as const,
    properties: {
      text: { type: "string" as const },
      count: { type: "number" as const },
      enabled: { type: "boolean" as const },
      tags: { type: "array" as const, items: { type: "string" as const } },
      task: {
        type: "object" as const,
        properties: {
          content: { type: "string" as const },
          status: { type: "string" as const }
        },
        required: ["content"]
      }
    },
    required: ["text"]
  };

  test("accepts valid input and extra fields", () => {
    expect(
      validateToolInput(schema, {
        text: "hello",
        count: 2,
        enabled: true,
        tags: ["a", "b"],
        extra: "allowed"
      })
    ).toBeUndefined();
  });

  test("reports missing required fields", () => {
    expect(validateToolInput(schema, {})?.message).toContain("Missing required");
  });

  test("reports scalar type errors", () => {
    const error = validateToolInput(schema, { text: 123 });

    expect(error).toEqual({
      code: "invalid_input",
      message: 'Expected "text" to be string.'
    });
  });

  test("reports array item type errors", () => {
    const error = validateToolInput(schema, { text: "ok", tags: ["a", 1] });

    expect(error).toEqual({
      code: "invalid_input",
      message: 'Expected "tags[1]" to be string.'
    });
  });

  test("reports nested object type errors", () => {
    const error = validateToolInput(schema, {
      text: "ok",
      task: { content: "Run tests", status: 1 }
    });

    expect(error).toEqual({
      code: "invalid_input",
      message: 'Expected "task.status" to be string.'
    });
  });

  test("reports missing nested object required fields", () => {
    const error = validateToolInput(schema, { text: "ok", task: { status: "pending" } });

    expect(error).toEqual({
      code: "invalid_input",
      message: 'Missing required field "task.content".'
    });
  });
});

describe("executeToolCall", () => {
  test("executes a valid tool call", async () => {
    const registry = new ToolRegistry([createEchoTool()]);

    await expect(
      executeToolCall(registry, {
        id: "call_1",
        name: "echo",
        input: { text: "hello" }
      })
    ).resolves.toEqual({
      callId: "call_1",
      toolName: "echo",
      ok: true,
      content: "hello"
    });
  });

  test("returns unknown_tool for missing tools", async () => {
    const result = await executeToolCall(new ToolRegistry(), {
      id: "call_1",
      name: "missing",
      input: {}
    });

    expect(result).toEqual({
      callId: "call_1",
      toolName: "missing",
      ok: false,
      error: {
        code: "unknown_tool",
        message: 'Unknown tool "missing".'
      }
    });
  });

  test("does not execute tools with invalid input", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const permissionPolicy = { decide: vi.fn(() => ({ behavior: "allow" as const })) };
    const tool = defineTool({
      name: "typed",
      description: "Requires text.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      {
        id: "call_1",
        name: "typed",
        input: { text: false }
      },
      { permissionPolicy }
    );

    if (result.ok) {
      throw new Error("Expected invalid input to fail.");
    }

    expect(result.error.code).toBe("invalid_input");
    expect(permissionPolicy.decide).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("does not execute tools denied by permission policy", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tool = defineTool({
      name: "write_note",
      description: "Writes a note.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "write_note", input: {} },
      { permissionPolicy: readOnlyPermissionPolicy() }
    );

    expect(result).toEqual({
      callId: "call_1",
      toolName: "write_note",
      ok: false,
      error: {
        code: "permission_denied",
        message: 'Permission denied for tool "write_note": Tool "write_note" is not read-only.'
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("does not execute tools that require permission approval", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tool = defineTool({
      name: "install_package",
      description: "Installs a package.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "install_package", input: {} },
      { permissionPolicy: createToolNamePermissionPolicy({ ask: ["install_package"] }) }
    );

    expect(result).toEqual({
      callId: "call_1",
      toolName: "install_package",
      ok: false,
      error: {
        code: "permission_denied",
        message: 'Permission required for tool "install_package": Tool "install_package" requires permission.'
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("executes an asked tool once after user approval", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "installed" }));
    const requestPermission = vi.fn(() =>
      Promise.resolve({
        behavior: "allow" as const,
        scope: "once" as const
      })
    );
    const tool = defineTool({
      name: "install_package",
      description: "Installs a package.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "install_package", input: {} },
      {
        permissionPolicy: createToolNamePermissionPolicy({ ask: ["install_package"] }),
        requestPermission
      }
    );

    expect(result).toEqual({
      callId: "call_1",
      toolName: "install_package",
      ok: true,
      content: "installed"
    });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  test("does not execute an asked tool after user rejection", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tool = defineTool({
      name: "write_note",
      description: "Writes a note.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "write_note", input: {} },
      {
        permissionPolicy: createToolNamePermissionPolicy({ ask: ["write_note"] }),
        requestPermission: () =>
          Promise.resolve({
            behavior: "deny",
            reason: "User rejected the request."
          })
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "permission_denied",
        message: 'Permission denied for tool "write_note": User rejected the request.'
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("fails closed when permission approval throws", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tool = defineTool({
      name: "write_note",
      description: "Writes a note.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "write_note", input: {} },
      {
        permissionPolicy: createToolNamePermissionPolicy({ ask: ["write_note"] }),
        requestPermission: () => Promise.reject(new Error("approval failed"))
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "permission_denied",
        message: 'Permission approval failed for tool "write_note".'
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("fails closed when permission policy throws", async () => {
    const execute = vi.fn(() => ({ ok: true as const, content: "bad" }));
    const tool = defineTool({
      name: "write_note",
      description: "Writes a note.",
      inputSchema: { type: "object" },
      execute
    });

    const result = await executeToolCall(
      new ToolRegistry([tool]),
      { id: "call_1", name: "write_note", input: {} },
      {
        permissionPolicy: {
          decide: () => {
            throw new Error("policy failed");
          }
        }
      }
    );

    expect(result).toEqual({
      callId: "call_1",
      toolName: "write_note",
      ok: false,
      error: {
        code: "permission_denied",
        message: 'Permission check failed for tool "write_note".'
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("preserves tool-returned failures", async () => {
    const tool = defineTool({
      name: "fail",
      description: "Always fails.",
      inputSchema: { type: "object" },
      execute: () => ({
        ok: false,
        error: {
          code: "execution_error",
          message: "planned failure"
        }
      })
    });

    await expect(
      executeToolCall(new ToolRegistry([tool]), {
        id: "call_1",
        name: "fail",
        input: {}
      })
    ).resolves.toEqual({
      callId: "call_1",
      toolName: "fail",
      ok: false,
      error: {
        code: "execution_error",
        message: "planned failure"
      }
    });
  });

  test("converts thrown errors to structured failures", async () => {
    const tool = defineTool({
      name: "thrower",
      description: "Throws.",
      inputSchema: { type: "object" },
      execute: () => {
        throw new Error("boom");
      }
    });

    await expect(
      executeToolCall(new ToolRegistry([tool]), {
        id: "call_1",
        name: "thrower",
        input: {}
      })
    ).resolves.toEqual({
      callId: "call_1",
      toolName: "thrower",
      ok: false,
      error: {
        code: "execution_error",
        message: "boom"
      }
    });
  });
});
