import { describe, expect, it } from "vitest";

import { renderAgentEvent, renderHelp, type CliOutput } from "../src/index.js";

function createOutput(): CliOutput & { stdout: string; stderr: string } {
  const state = { stdout: "", stderr: "" };

  return {
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    writeStdout(text) {
      state.stdout += text;
    },
    writeStderr(text) {
      state.stderr += text;
    }
  };
}

describe("renderAgentEvent", () => {
  it("writes text deltas to stdout", () => {
    const output = createOutput();

    renderAgentEvent({ type: "text_delta", text: "hello" }, output);

    expect(output.stdout).toBe("hello");
    expect(output.stderr).toBe("");
  });

  it("writes agent errors to stderr", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "error",
        error: { code: "provider_error", message: "provider failed" }
      },
      output
    );

    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("Error: provider failed\n");
  });

  it("adds a newline at successful turn end", () => {
    const output = createOutput();

    renderAgentEvent({ type: "turn_end", reason: "completed" }, output);

    expect(output.stdout).toBe("\n");
  });

  it("renders tool calls and successful tool results", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "tool_call",
        call: { id: "call_1", name: "echo", input: { text: "hello" } }
      },
      output
    );
    renderAgentEvent(
      {
        type: "tool_result",
        result: {
          callId: "call_1",
          toolName: "echo",
          ok: true,
          content: "hello"
        }
      },
      output
    );

    expect(output.stdout).toBe("\n[tool] echo\n[tool result] hello\n");
    expect(output.stderr).toBe("");
  });

  it("renders failed tool results to stderr", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "tool_result",
        result: {
          callId: "call_1",
          toolName: "missing",
          ok: false,
          error: { code: "unknown_tool", message: "Unknown tool." }
        }
      },
      output
    );

    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("[tool error] Unknown tool.\n");
  });

  it("renders permission denied tool results to stderr", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "tool_result",
        result: {
          callId: "call_1",
          toolName: "write_note",
          ok: false,
          error: {
            code: "permission_denied",
            message: 'Permission denied for tool "write_note".'
          }
        }
      },
      output
    );

    expect(output.stdout).toBe("");
    expect(output.stderr).toBe('[tool error] Permission denied for tool "write_note".\n');
  });

  it("keeps internal tool messages quiet", () => {
    const output = createOutput();

    renderAgentEvent(
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
      output
    );

    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("");
  });

  it("keeps internal agent events quiet", () => {
    const output = createOutput();

    renderAgentEvent({ type: "model_response_start" }, output);

    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("");
  });

  it("renders todo updates in stable status order", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "todo_updated",
        ownerId: "main",
        todos: [
          {
            content: "Write docs",
            activeForm: "Writing docs",
            status: "pending"
          },
          {
            content: "Run tests",
            activeForm: "Running tests",
            status: "in_progress"
          },
          {
            content: "Inspect ccb",
            activeForm: "Inspecting ccb",
            status: "completed"
          }
        ]
      },
      output
    );

    expect(output.stdout).toBe(
      [
        "[todo]",
        "  - in_progress: Run tests",
        "  - pending: Write docs",
        "  - completed: Inspect ccb",
        ""
      ].join("\n")
    );
  });

  it("renders an empty todo list as completed", () => {
    const output = createOutput();

    renderAgentEvent({ type: "todo_updated", ownerId: "main", todos: [] }, output);

    expect(output.stdout).toBe("[todo] all tasks completed\n");
  });

  it("renders sub-agent events with indentation", () => {
    const output = createOutput();

    renderAgentEvent(
      {
        type: "sub_agent_event",
        description: "inspect-auth",
        event: {
          type: "tool_call",
          call: { id: "call_1", name: "read_file", input: { file_path: "auth.ts" } }
        }
      },
      output
    );

    expect(output.stdout).toBe("  [sub-agent tool] read_file\n");
  });
});

describe("renderHelp", () => {
  it("prints the minimal REPL commands", () => {
    const output = createOutput();

    renderHelp(output);

    expect(output.stdout).toContain("/help");
    expect(output.stdout).toContain("/reset");
    expect(output.stdout).toContain("/save");
    expect(output.stdout).toContain("/sessions");
    expect(output.stdout).toContain("exit");
  });
});
