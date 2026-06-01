import { describe, expect, it } from "vitest";

import {
  allowAllPermissionPolicy,
  commandMatchesPrefix,
  commandPrefixKey,
  createToolNamePermissionPolicy,
  defineTool,
  interactivePermissionPolicy,
  readOnlyPermissionPolicy,
  suggestCommandPrefix,
  type Tool
} from "../src/index.js";

function createTool(options: {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly isReadOnly?: boolean;
}): Tool {
  return defineTool({
    name: options.name,
    ...(options.aliases === undefined ? {} : { aliases: options.aliases }),
    description: "Test tool.",
    inputSchema: { type: "object" },
    ...(options.isReadOnly === undefined ? {} : { isReadOnly: options.isReadOnly }),
    execute: () => ({ ok: true, content: "ok" })
  });
}

describe("permission policies", () => {
  it("allows every tool with allowAllPermissionPolicy", async () => {
    const tool = createTool({ name: "write_note" });
    const policy = allowAllPermissionPolicy();

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "allow"
    });
  });

  it("allows read-only tools with readOnlyPermissionPolicy", async () => {
    const tool = createTool({ name: "read_note", isReadOnly: true });
    const policy = readOnlyPermissionPolicy();

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "allow"
    });
  });

  it("denies non-read-only tools with readOnlyPermissionPolicy", async () => {
    const tool = createTool({ name: "write_note", isReadOnly: false });
    const policy = readOnlyPermissionPolicy();

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: 'Tool "write_note" is not read-only.'
    });
  });

  it("uses custom read-only deny reasons", async () => {
    const tool = createTool({ name: "write_note", isReadOnly: false });
    const policy = readOnlyPermissionPolicy({ denyReason: "Read-only mode." });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: "Read-only mode."
    });
  });

  it("asks for non-read-only tools with interactivePermissionPolicy", async () => {
    const tool = createTool({ name: "write_note", isReadOnly: false });
    const policy = interactivePermissionPolicy({ sessionAllowedTools: new Set() });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "ask",
      reason: 'Tool "write_note" requires user approval.'
    });
  });

  it("allows read-only and session-approved tools with interactivePermissionPolicy", async () => {
    const readTool = createTool({ name: "read_note", isReadOnly: true });
    const writeTool = createTool({ name: "write_note", isReadOnly: false });
    const policy = interactivePermissionPolicy({
      sessionAllowedTools: new Set(["write_note"])
    });

    expect(await policy.decide({ tool: readTool, input: {}, context: {} })).toEqual({
      behavior: "allow"
    });
    expect(await policy.decide({ tool: writeTool, input: {}, context: {} })).toEqual({
      behavior: "allow"
    });
  });

  it("matches command prefixes on whitespace boundaries", () => {
    expect(commandMatchesPrefix("bun run test", "bun run")).toBe(true);
    expect(commandMatchesPrefix("bun run", "bun run")).toBe(true);
    expect(commandMatchesPrefix("bun runtime", "bun run")).toBe(false);
    expect(commandMatchesPrefix("github status", "git")).toBe(false);
  });

  it("suggests conservative command prefixes", () => {
    expect(suggestCommandPrefix({ toolName: "powershell", command: "bun run test" })).toEqual({
      ok: true,
      rule: { toolName: "powershell", prefix: "bun run" }
    });
    expect(
      suggestCommandPrefix({ toolName: "powershell", command: "git status --short" })
    ).toEqual({
      ok: true,
      rule: { toolName: "powershell", prefix: "git status" }
    });
    expect(suggestCommandPrefix({ toolName: "powershell", command: "powershell foo" })).toEqual({
      ok: false,
      reason: 'Command prefix "powershell" is too broad or unsafe.'
    });
    expect(suggestCommandPrefix({ toolName: "bash", command: "rm -rf tmp" })).toEqual({
      ok: false,
      reason: 'Command prefix "rm" is too broad or unsafe.'
    });
  });

  it("allows matching command prefixes with interactivePermissionPolicy", async () => {
    const tool = createTool({ name: "powershell", isReadOnly: false });
    const prefixKey = commandPrefixKey({
      toolName: "powershell",
      prefix: "bun run"
    });
    const policy = interactivePermissionPolicy({
      sessionAllowedTools: new Set(),
      sessionAllowedCommandPrefixes: new Set([prefixKey])
    });

    expect(
      await policy.decide({
        tool,
        input: { command: "bun run test" },
        context: {}
      })
    ).toEqual({ behavior: "allow" });
    expect(
      await policy.decide({
        tool,
        input: { command: "git status" },
        context: {}
      })
    ).toEqual({
      behavior: "ask",
      reason: 'Tool "powershell" requires user approval.'
    });
  });

  it("does not allow command tools by whole tool name in interactivePermissionPolicy", async () => {
    const tool = createTool({ name: "powershell", isReadOnly: false });
    const policy = interactivePermissionPolicy({
      sessionAllowedTools: new Set(["powershell"])
    });

    expect(
      await policy.decide({
        tool,
        input: { command: "Write-Output still-asks" },
        context: {}
      })
    ).toEqual({
      behavior: "ask",
      reason: 'Tool "powershell" requires user approval.'
    });
  });

  it("allows tools by name", async () => {
    const tool = createTool({ name: "read_note" });
    const policy = createToolNamePermissionPolicy({ allow: ["read_note"] });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "allow"
    });
  });

  it("matches tool aliases", async () => {
    const tool = createTool({ name: "read_note", aliases: ["read"] });
    const policy = createToolNamePermissionPolicy({ deny: ["read"] });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: 'Tool "read_note" is denied by policy.'
    });
  });

  it("denies tools by name", async () => {
    const tool = createTool({ name: "write_note" });
    const policy = createToolNamePermissionPolicy({ deny: ["write_note"] });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: 'Tool "write_note" is denied by policy.'
    });
  });

  it("asks for tools by name", async () => {
    const tool = createTool({ name: "install_package" });
    const policy = createToolNamePermissionPolicy({ ask: ["install_package"] });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "ask",
      reason: 'Tool "install_package" requires permission.'
    });
  });

  it("prefers deny over ask and allow", async () => {
    const tool = createTool({ name: "mixed" });
    const policy = createToolNamePermissionPolicy({
      allow: ["mixed"],
      ask: ["mixed"],
      deny: ["mixed"]
    });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: 'Tool "mixed" is denied by policy.'
    });
  });

  it("uses a custom default decision", async () => {
    const tool = createTool({ name: "unknown" });
    const policy = createToolNamePermissionPolicy({
      defaultDecision: { behavior: "deny", reason: "Not explicitly allowed." }
    });

    expect(await policy.decide({ tool, input: {}, context: {} })).toEqual({
      behavior: "deny",
      reason: "Not explicitly allowed."
    });
  });
});
