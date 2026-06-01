import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Agent,
  MockModelProvider,
  ToolRegistry,
  createFileTools,
  executeToolCall,
  readOnlyPermissionPolicy,
  resolveWorkspacePath
} from "../src/index.js";

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-file-tools-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function registry(): ToolRegistry {
  return new ToolRegistry(createFileTools({ workspaceRoot, readLimit: 2, searchLimit: 2 }));
}

async function writeFixture(relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

describe("File Tools", () => {
  it("resolves workspace paths and rejects outside paths", async () => {
    await expect(resolveWorkspacePath("inside.txt", workspaceRoot)).resolves.toEqual({
      absolutePath: path.join(workspaceRoot, "inside.txt"),
      relativePath: "inside.txt"
    });

    await expect(resolveWorkspacePath("../outside.txt", workspaceRoot)).rejects.toThrow(
      /outside workspace/
    );
  });

  it("read_file reads files with line numbers and limits", async () => {
    await writeFixture("notes.txt", "one\ntwo\nthree\n");

    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "read_file",
      input: { file_path: "notes.txt", offset: 2, limit: 2 }
    });

    expect(result).toEqual({
      callId: "call_1",
      toolName: "read_file",
      ok: true,
      content: "2\ttwo\n3\tthree"
    });
  });

  it("read_file reports directories as recoverable tool output", async () => {
    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "read_file",
      input: { file_path: "." }
    });

    expect(result).toMatchObject({
      ok: true,
      content: "Error: not a file: "
    });
  });

  it("write_file creates parent directories and reports deterministic line counts", async () => {
    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "write_file",
      input: { file_path: "notes/todo.txt", content: "one\ntwo\n" }
    });

    await expect(readFile(path.join(workspaceRoot, "notes/todo.txt"), "utf8")).resolves.toBe(
      "one\ntwo\n"
    );
    expect(result).toEqual({
      callId: "call_1",
      toolName: "write_file",
      ok: true,
      content: "Wrote 2 lines to notes/todo.txt"
    });
  });

  it("write_file rejects paths outside the workspace", async () => {
    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "write_file",
      input: { file_path: "../outside.txt", content: "bad" }
    });

    expect(result).toMatchObject({
      callId: "call_1",
      toolName: "write_file",
      ok: false,
      error: { code: "execution_error" }
    });
  });

  it("edit_file replaces one unique string and returns a compact diff", async () => {
    await writeFixture("src/app.ts", "const value = 1;\nconsole.log(value);\n");

    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "edit_file",
      input: {
        file_path: "src/app.ts",
        old_string: "const value = 1;",
        new_string: "const value = 2;"
      }
    });

    await expect(readFile(path.join(workspaceRoot, "src/app.ts"), "utf8")).resolves.toBe(
      "const value = 2;\nconsole.log(value);\n"
    );
    expect(result).toMatchObject({
      ok: true,
      content:
        "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-const value = 1;\n+const value = 2;\n console.log(value);\n"
    });
  });

  it("edit_file leaves files unchanged when old_string is missing or ambiguous", async () => {
    await writeFixture("dup.txt", "same\nsame\n");

    const missing = await executeToolCall(registry(), {
      id: "call_1",
      name: "edit_file",
      input: { file_path: "dup.txt", old_string: "missing", new_string: "new" }
    });
    const duplicate = await executeToolCall(registry(), {
      id: "call_2",
      name: "edit_file",
      input: { file_path: "dup.txt", old_string: "same", new_string: "new" }
    });

    expect(missing).toMatchObject({
      ok: true,
      content: "Error: old_string not found in dup.txt. Read the file again before editing."
    });
    expect(duplicate).toMatchObject({
      ok: true,
      content: "Error: old_string appears 2 times in dup.txt. Include more surrounding context."
    });
    await expect(readFile(path.join(workspaceRoot, "dup.txt"), "utf8")).resolves.toBe(
      "same\nsame\n"
    );
  });

  it("glob returns sorted limited file matches and skips noisy directories", async () => {
    await writeFixture("b.ts", "b");
    await writeFixture("a.ts", "a");
    await writeFixture("node_modules/hidden.ts", "hidden");

    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "glob",
      input: { pattern: "**/*.ts" }
    });

    expect(result).toEqual({
      callId: "call_1",
      toolName: "glob",
      ok: true,
      content: "a.ts\nb.ts"
    });
  });

  it("grep searches matching lines and supports include filters", async () => {
    await writeFixture("src/a.ts", "alpha\nneedle one\n");
    await writeFixture("src/b.js", "needle two\n");

    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "grep",
      input: { pattern: "needle", include: "**/*.ts" }
    });

    expect(result).toEqual({
      callId: "call_1",
      toolName: "grep",
      ok: true,
      content: "src/a.ts:2: needle one"
    });
  });

  it("grep reports invalid regex as recoverable output", async () => {
    const result = await executeToolCall(registry(), {
      id: "call_1",
      name: "grep",
      input: { pattern: "[" }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("Invalid regex:");
    }
  });

  it("read-only permission blocks write_file before disk mutation", async () => {
    const result = await executeToolCall(
      registry(),
      {
        id: "call_1",
        name: "write_file",
        input: { file_path: "blocked.txt", content: "nope" }
      },
      { permissionPolicy: readOnlyPermissionPolicy() }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied" }
    });
    await expect(readFile(path.join(workspaceRoot, "blocked.txt"), "utf8")).rejects.toThrow();
  });

  it("Agent Loop can consume read_file and pass the result to the next model request", async () => {
    await writeFixture("package.json", "{\"name\":\"mini\"}\n");
    const provider = new MockModelProvider([
      {
        type: "response",
        content: "",
        stopReason: "tool_use",
        toolCalls: [
          { id: "call_1", name: "read_file", input: { file_path: "package.json" } }
        ]
      },
      { type: "response", content: "package read" }
    ]);
    const agent = new Agent({ provider, tools: registry(), maxTurns: 1 });

    await expect(agent.run("read package")).resolves.toMatchObject({
      content: "package read",
      stopReason: "completed",
      messages: [
        { role: "user", content: "read package" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "read_file", input: { file_path: "package.json" } }
          ]
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "read_file",
          content: '1\t{"name":"mini"}',
          isError: false
        },
        { role: "assistant", content: "package read" }
      ]
    });
  });
});
