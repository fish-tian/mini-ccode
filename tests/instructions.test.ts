import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildDefaultSystemPrompt,
  createInstructionContext,
  defineTool,
  createTodoState,
  createTodoWriteTool,
  loadProjectInstructions
} from "../src/index.js";

const tempDirs: string[] = [];

function createReadTool() {
  return defineTool({
    name: "read_file",
    description: "Read a file.",
    inputSchema: { type: "object" },
    isReadOnly: true,
    execute: () => ({ ok: true, content: "" })
  });
}

function createAgentTool() {
  return defineTool({
    name: "agent",
    description: "Start a sub-agent.",
    inputSchema: { type: "object" },
    execute: () => ({ ok: true, content: "" })
  });
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-instructions-"));
  tempDirs.push(dir);
  return dir;
}

describe("instructions", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it("builds a default prompt from environment, tools, and permission mode", () => {
    const prompt = buildDefaultSystemPrompt({
      workspaceRoot: "C:\\workspace",
      tools: [createReadTool()],
      permissionMode: "default",
      now: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(prompt).toContain("# Identity");
    expect(prompt).toContain("You are mini-ccode");
    expect(prompt).toContain("Working directory: C:\\workspace");
    expect(prompt).toContain("Current date: 2026-05-30");
    expect(prompt).toContain("Permission mode: default approval mode");
    expect(prompt).toContain("read_file: Read a file.");
  });

  it("includes TodoWrite guidance only when the tool is available", () => {
    const withoutTodo = buildDefaultSystemPrompt({
      workspaceRoot: "C:\\workspace",
      tools: [createReadTool()],
      permissionMode: "default",
      now: new Date("2026-05-30T00:00:00.000Z")
    });
    const withTodo = buildDefaultSystemPrompt({
      workspaceRoot: "C:\\workspace",
      tools: [createTodoWriteTool(createTodoState()), createReadTool()],
      permissionMode: "default",
      now: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(withoutTodo).not.toContain("use TodoWrite");
    expect(withTodo).toContain("use TodoWrite");
    expect(withTodo).toContain("multi-step");
  });

  it("includes sub-agent guidance only when agent is available", () => {
    const withoutAgent = buildDefaultSystemPrompt({
      workspaceRoot: "C:\\workspace",
      tools: [createReadTool()],
      permissionMode: "default",
      now: new Date("2026-05-30T00:00:00.000Z")
    });
    const withAgent = buildDefaultSystemPrompt({
      workspaceRoot: "C:\\workspace",
      tools: [createAgentTool(), createReadTool()],
      permissionMode: "default",
      now: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(withoutAgent).not.toContain("Use agent for complex independent sub-tasks");
    expect(withAgent).toContain("Actively consider agent");
    expect(withAgent).toContain("Prefer agent with subagent_type explore");
    expect(withAgent).toContain("Prefer agent with subagent_type general");
    expect(withAgent).toContain("subagent_type defaults to general");
    expect(withAgent).toContain("A fresh sub-agent has not seen this conversation");
    expect(withAgent).toContain("Avoid vague prompts");
  });

  it("loads AGENTS.md when present and returns undefined when absent", async () => {
    const withInstructions = await createTempDir();
    await writeFile(
      path.join(withInstructions, "AGENTS.md"),
      "# Rules\n\nAlways test.",
      "utf8"
    );
    const withoutInstructions = await createTempDir();

    await expect(loadProjectInstructions(withInstructions)).resolves.toMatchObject({
      source: "AGENTS.md",
      content: "# Rules\n\nAlways test."
    });
    await expect(loadProjectInstructions(withoutInstructions)).resolves.toBeUndefined();
  });

  it("creates system prompt and project context messages separately", async () => {
    const workspaceRoot = await createTempDir();
    await writeFile(
      path.join(workspaceRoot, "AGENTS.md"),
      "# Project Rules\n\nUse the module workflow.",
      "utf8"
    );

    const result = await createInstructionContext({
      workspaceRoot,
      tools: [createReadTool()],
      permissionMode: "read-only",
      now: new Date("2026-05-30T00:00:00.000Z"),
      appendSystemPrompt: "Prefer concise replies."
    });

    expect(result.systemPrompt).toContain("Permission mode: read-only mode");
    expect(result.systemPrompt).toContain("# Additional System Instructions");
    expect(result.systemPrompt).toContain("Prefer concise replies.");
    expect(result.systemPrompt).not.toContain("Use the module workflow.");
    expect(result.contextMessages).toHaveLength(1);
    expect(result.contextMessages[0]?.role).toBe("user");
    expect(result.contextMessages[0]?.content).toContain("Use the module workflow.");
  });

  it("custom system prompt replaces the default prompt but keeps project context", async () => {
    const workspaceRoot = await createTempDir();
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "Project rule.", "utf8");

    const result = await createInstructionContext({
      workspaceRoot,
      tools: [createReadTool()],
      permissionMode: "allow-all",
      systemPrompt: "Custom agent.",
      appendSystemPrompt: "Extra rule."
    });

    expect(result.systemPrompt).toBe(
      "Custom agent.\n\n# Additional System Instructions\nExtra rule."
    );
    expect(result.contextMessages[0]?.content).toContain("Project rule.");
  });
});
