import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ToolRegistry,
  createCommandTools,
  executeToolCall,
  readOnlyPermissionPolicy,
  type CommandRunner
} from "../src/index.js";

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-command-tools-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function registry(runner: CommandRunner, platform: NodeJS.Platform = "win32"): ToolRegistry {
  return new ToolRegistry(createCommandTools({ workspaceRoot, platform, runner }));
}

describe("Command Tools", () => {
  it("creates a platform-specific command tool", () => {
    const runner: CommandRunner = () =>
      Promise.resolve({ kind: "completed", stdout: "", stderr: "", exitCode: 0 });

    expect(createCommandTools({ platform: "win32", runner })[0]?.name).toBe("powershell");
    expect(createCommandTools({ platform: "linux", runner })[0]?.name).toBe("bash");
    expect(createCommandTools({ platform: "win32", runner })[0]?.isReadOnly).toBe(false);
  });

  it("passes the shell, fixed workspace and timeout to its runner", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "ok\n", stderr: "", exitCode: 0 })
    );

    const result = await executeToolCall(registry(runner), {
      id: "call_1",
      name: "powershell",
      input: { command: "Write-Output ok", timeout_ms: 5000 }
    });

    expect(result).toMatchObject({ ok: true, content: "ok" });
    expect(runner).toHaveBeenCalledWith({
      shell: "powershell",
      command: "Write-Output ok",
      cwd: workspaceRoot,
      timeoutMs: 5000
    });
  });

  it("formats stderr, non-zero exit codes, empty output and timeouts", async () => {
    const failed = await executeToolCall(
      registry(() =>
        Promise.resolve({
          kind: "completed",
          stdout: "running\n",
          stderr: "failed\n",
          exitCode: 1
        })
      ),
      { id: "call_1", name: "powershell", input: { command: "test" } }
    );
    const empty = await executeToolCall(
      registry(() =>
        Promise.resolve({ kind: "completed", stdout: "", stderr: "", exitCode: 0 })
      ),
      { id: "call_2", name: "powershell", input: { command: "empty" } }
    );
    const timeout = await executeToolCall(
      registry(() => Promise.resolve({ kind: "timeout", timeoutMs: 2000 })),
      {
        id: "call_3",
        name: "powershell",
        input: { command: "slow", timeout_ms: 2000 }
      }
    );

    expect(failed).toMatchObject({
      ok: true,
      content: "running\n[stderr]\nfailed\n[exit code: 1]"
    });
    expect(empty).toMatchObject({ ok: true, content: "(no output)" });
    expect(timeout).toMatchObject({
      ok: true,
      content: "Command timed out after 2000 ms."
    });
  });

  it("rejects blank commands and invalid timeout values before invoking the runner", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "bad", stderr: "", exitCode: 0 })
    );

    const blank = await executeToolCall(registry(runner), {
      id: "call_1",
      name: "powershell",
      input: { command: " " }
    });
    const timeout = await executeToolCall(registry(runner), {
      id: "call_2",
      name: "powershell",
      input: { command: "ok", timeout_ms: 120001 }
    });

    expect(blank).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(timeout).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not call the runner when read-only permission denies commands", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "bad", stderr: "", exitCode: 0 })
    );

    const result = await executeToolCall(
      registry(runner),
      { id: "call_1", name: "powershell", input: { command: "Write-Output ok" } },
      { permissionPolicy: readOnlyPermissionPolicy() }
    );

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(runner).not.toHaveBeenCalled();
  });

  it("truncates long output deterministically", async () => {
    const result = await executeToolCall(
      new ToolRegistry(
        createCommandTools({
          workspaceRoot,
          platform: "win32",
          maxOutputChars: 40,
          runner: () =>
            Promise.resolve({
              kind: "completed",
              stdout: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
              stderr: "",
              exitCode: 0
            })
        })
      ),
      { id: "call_1", name: "powershell", input: { command: "long" } }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toHaveLength(40);
      expect(result.content).toContain("output truncated");
    }
  });
});
