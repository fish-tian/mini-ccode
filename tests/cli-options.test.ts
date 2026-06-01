import { describe, expect, it } from "vitest";

import { parseCliArgs, permissionPolicyForCliMode } from "../src/index.js";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";

describe("parseCliArgs", () => {
  it("defaults to interactive permission mode and preserves prompt text", () => {
    expect(parseCliArgs(["review", "this", "project"])).toEqual({
      ok: true,
      prompt: "review this project",
      permissionMode: "default",
      contextLimit: 128000
    });
  });

  it("parses explicit permission modes without including them in the prompt", () => {
    expect(parseCliArgs(["--permission-mode", "read-only", "review", "this"])).toEqual({
      ok: true,
      prompt: "review this",
      permissionMode: "read-only",
      contextLimit: 128000
    });
    expect(parseCliArgs(["edit", "this", "--permission-mode", "allow-all"])).toEqual({
      ok: true,
      prompt: "edit this",
      permissionMode: "allow-all",
      contextLimit: 128000
    });
    expect(parseCliArgs(["--permission-mode", "default", "edit", "this"])).toEqual({
      ok: true,
      prompt: "edit this",
      permissionMode: "default",
      contextLimit: 128000
    });
  });

  it("rejects missing, invalid, and repeated permission modes", () => {
    expect(parseCliArgs(["--permission-mode"])).toEqual({
      ok: false,
      message: "Missing value for --permission-mode. Expected: default, read-only, or allow-all."
    });
    expect(
      parseCliArgs([
        "--permission-mode",
        "read-only",
        "--permission-mode",
        "allow-all"
      ])
    ).toEqual({
      ok: false,
      message: "--permission-mode may be specified only once."
    });
  });

  it("parses a resume session id without including it in the prompt", () => {
    expect(parseCliArgs(["--resume", sessionId, "continue", "work"])).toEqual({
      ok: true,
      prompt: "continue work",
      permissionMode: "default",
      contextLimit: 128000,
      resumeSessionId: sessionId
    });
  });

  it("parses an explicit context limit without including it in the prompt", () => {
    expect(parseCliArgs(["--context-limit", "5000", "review"])).toEqual({
      ok: true,
      prompt: "review",
      permissionMode: "default",
      contextLimit: 5000
    });
  });

  it("parses system prompt options without including them in the prompt", () => {
    expect(
      parseCliArgs([
        "--system-prompt",
        "custom system",
        "--append-system-prompt",
        "extra system",
        "review"
      ])
    ).toEqual({
      ok: true,
      prompt: "review",
      permissionMode: "default",
      contextLimit: 128000,
      systemPrompt: "custom system",
      appendSystemPrompt: "extra system"
    });
  });

  it("rejects missing and repeated system prompt options", () => {
    expect(parseCliArgs(["--system-prompt"])).toEqual({
      ok: false,
      message: "Missing value for --system-prompt. Expected prompt text."
    });
    expect(parseCliArgs(["--append-system-prompt"])).toEqual({
      ok: false,
      message: "Missing value for --append-system-prompt. Expected prompt text."
    });
    expect(parseCliArgs(["--system-prompt", "one", "--system-prompt", "two"])).toEqual({
      ok: false,
      message: "--system-prompt may be specified only once."
    });
    expect(
      parseCliArgs([
        "--append-system-prompt",
        "one",
        "--append-system-prompt",
        "two"
      ])
    ).toEqual({
      ok: false,
      message: "--append-system-prompt may be specified only once."
    });
  });

  it("rejects missing, invalid, and repeated context limits", () => {
    expect(parseCliArgs(["--context-limit"])).toEqual({
      ok: false,
      message: "Missing value for --context-limit. Expected an integer token limit."
    });
    expect(parseCliArgs(["--context-limit", "99"])).toEqual({
      ok: false,
      message: 'Invalid context limit "99". Expected an integer token limit of at least 100.'
    });
    expect(parseCliArgs(["--context-limit", "1000", "--context-limit", "2000"])).toEqual({
      ok: false,
      message: "--context-limit may be specified only once."
    });
  });

  it("rejects missing, invalid, and repeated resume session ids", () => {
    expect(parseCliArgs(["--resume"])).toEqual({
      ok: false,
      message: "Missing value for --resume. Expected a session UUID."
    });
    expect(parseCliArgs(["--resume", "old-session"])).toEqual({
      ok: false,
      message: 'Invalid session id "old-session". Expected a UUID.'
    });
    expect(parseCliArgs(["--resume", sessionId, "--resume", sessionId])).toEqual({
      ok: false,
      message: "--resume may be specified only once."
    });
  });
});

describe("permissionPolicyForCliMode", () => {
  it("converts CLI modes into usable permission policies", async () => {
    const tool = {
      name: "write_file",
      description: "Write.",
      inputSchema: { type: "object" as const },
      isReadOnly: false,
      isConcurrencySafe: false,
      execute: () => ({ ok: true as const, content: "done" })
    };

    expect(
      await permissionPolicyForCliMode("default").decide({
        tool,
        input: {},
        context: {}
      })
    ).toEqual({
      behavior: "ask",
      reason: 'Tool "write_file" requires user approval.'
    });
    expect(
      await permissionPolicyForCliMode("read-only").decide({
        tool,
        input: {},
        context: {}
      })
    ).toEqual({
      behavior: "deny",
      reason: "CLI is running in read-only mode."
    });
    expect(
      await permissionPolicyForCliMode("allow-all").decide({
        tool,
        input: {},
        context: {}
      })
    ).toEqual({ behavior: "allow" });
  });
});
