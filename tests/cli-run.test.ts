import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCommandTools,
  createSessionStore,
  MockModelProvider,
  runCli,
  type LanguageModelProvider,
  type ModelRequest,
  type CommandRunner,
  type ModelStreamEvent,
  type SessionStore
} from "../src/index.js";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";

class RecordingProvider implements LanguageModelProvider {
  readonly requests: ModelRequest[] = [];
  readonly #delegate: LanguageModelProvider;

  constructor(delegate: LanguageModelProvider) {
    this.#delegate = delegate;
  }

  complete(request: ModelRequest) {
    this.requests.push(request);
    return this.#delegate.complete(request);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    yield* this.#delegate.stream(request);
  }
}

class ThrowingOnceProvider implements LanguageModelProvider {
  #thrown = false;

  complete(): never {
    throw new Error("complete is not used by the CLI");
  }

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();

    if (!this.#thrown) {
      this.#thrown = true;
      throw new Error("stream crashed");
    }

    yield { type: "response_start" };
    yield { type: "text_delta", text: "recovered" };
    yield {
      type: "response_stop",
      response: {
        content: "recovered",
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 }
      }
    };
  }
}

function createWritable(): PassThrough & { output: string } {
  const stream = new PassThrough() as PassThrough & { output: string };
  stream.output = "";
  stream.on("data", (chunk: unknown) => {
    stream.output += String(chunk);
  });
  return stream;
}

function cliOptions(
  args: readonly string[],
  provider: LanguageModelProvider,
  lines?: readonly string[],
  createStore?: (workspaceRoot: string) => SessionStore,
  commandRunner?: CommandRunner
) {
  const stdout = createWritable();
  const stderr = createWritable();

  return {
    options: {
      args,
      stdin: new PassThrough(),
      stdout,
      stderr,
      createProvider: () => provider,
      ...(createStore === undefined ? {} : { createSessionStore: createStore }),
      ...(commandRunner === undefined
        ? {}
        : {
            createCommandTools: (workspaceRoot: string) =>
              createCommandTools({
                workspaceRoot,
                platform: "win32",
                runner: commandRunner
              })
          }),
      ...(lines === undefined ? {} : { lineSource: lines })
    },
    stdout,
    stderr
  };
}

describe("runCli", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs one-shot prompts through the agent event stream", async () => {
    const { options, stdout, stderr } = cliOptions(
      ["hello"],
      new MockModelProvider([{ type: "response", content: "hi", deltas: ["h", "i"] }])
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toBe("hi\n");
    expect(stderr.output).toBe("");
  });

  it("sends default system prompt and project instructions through the CLI agent", async () => {
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "hi" }])
    );
    const { options } = cliOptions(["hello"], provider);

    await expect(runCli(options)).resolves.toBe(0);

    const systemMessage = provider.requests[0]?.messages[0];
    const projectMessage = provider.requests[0]?.messages[1];
    expect(systemMessage?.role).toBe("system");
    expect(systemMessage?.content).toContain("You are mini-ccode");
    expect(projectMessage?.role).toBe("user");
    expect(projectMessage?.content).toContain("<project-instructions>");
    expect(provider.requests[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: "hello"
    });
  });

  it("supports custom and appended system prompts through CLI args", async () => {
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "hi" }])
    );
    const { options } = cliOptions(
      [
        "--system-prompt",
        "Custom reviewer.",
        "--append-system-prompt",
        "Only report findings.",
        "review"
      ],
      provider
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(provider.requests[0]?.messages[0]).toEqual({
      role: "system",
      content: "Custom reviewer.\n\n# Additional System Instructions\nOnly report findings."
    });
    expect(provider.requests[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: "review"
    });
  });

  it("returns a non-zero exit code for one-shot provider errors", async () => {
    const { options, stdout, stderr } = cliOptions(
      ["fail"],
      new MockModelProvider([
        {
          type: "error",
          error: { code: "provider_error", message: "model failed" }
        }
      ])
    );

    await expect(runCli(options)).resolves.toBe(1);

    expect(stdout.output).toBe("");
    expect(stderr.output).toBe("Error: model failed\n");
  });

  it("runs a minimal REPL with prompt, reset, and exit", async () => {
    const provider = new MockModelProvider([
      { type: "response", content: "first" },
      { type: "response", content: "second" }
    ]);
    const { options, stdout, stderr } = cliOptions(
      [],
      provider,
      ["hello", "/reset", "again", "exit"]
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("mini-ccode");
    expect(stdout.output).toContain("Permission mode: default");
    expect(stdout.output).toContain("first");
    expect(stdout.output).toContain("Conversation reset.");
    expect(stdout.output).toContain("second");
    expect(stdout.output).toContain("bye");
    expect(stderr.output).toBe("");
  });

  it("keeps the REPL alive after an unexpected agent error", async () => {
    const { options, stdout, stderr } = cliOptions(
      [],
      new ThrowingOnceProvider(),
      ["first", "second", "exit"]
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stderr.output).toContain("Error: stream crashed");
    expect(stdout.output).toContain("mini-ccode");
    expect(stdout.output).toContain("recovered");
    expect(stdout.output).toContain("bye");
  });

  it("compacts resumed context through the REPL command", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-compact-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot });
    await createStore(process.cwd()).save(
      Array.from({ length: 9 }, (_, index) => ({
        role: "user" as const,
        content: `old message ${index + 1}`
      })),
      sessionId
    );
    const { options, stdout, stderr } = cliOptions(
      ["--resume", sessionId],
      new MockModelProvider([{ type: "response", content: "summary" }]),
      ["/compact", "exit"],
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stdout.output).toContain("[context] Compacted context: estimated");
    expect(stderr.output).toBe("");
  });

  it("prints automatic context compaction before a one-shot response", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-auto-compact-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot });
    await createStore(process.cwd()).save(
      Array.from({ length: 9 }, (_, index) => ({
        role: "user" as const,
        content: `old message ${index + 1} ${"x".repeat(80)}`
      })),
      sessionId
    );
    const { options, stdout, stderr } = cliOptions(
      ["--resume", sessionId, "--context-limit", "100", "continue"],
      new MockModelProvider([
        { type: "response", content: "summary" },
        { type: "response", content: "continued", deltas: ["continued"] }
      ]),
      undefined,
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stdout.output).toContain("[context] Automatically compacted context");
    expect(stdout.output).toContain("continued");
    expect(stderr.output).toBe("");
  });

  it("registers File Tools in the CLI agent", async () => {
    await writeFile("cli-fixture.txt", "hello from file\n", "utf8");
    const { options, stdout, stderr } = cliOptions(
      ["--permission-mode", "read-only", "read fixture"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_1", name: "read_file", input: { file_path: "cli-fixture.txt" } }
          ]
        },
        { type: "response", content: "Read the fixture." }
      ])
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
    } finally {
      await rm("cli-fixture.txt", { force: true });
    }

    expect(stdout.output).toContain("[tool] read_file");
    expect(stdout.output).toContain("[tool result] 1\thello from file");
    expect(stdout.output).toContain("Read the fixture.");
    expect(stderr.output).toBe("");
  });

  it("registers TodoWrite in the default CLI agent", async () => {
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "ready" }])
    );
    const { options } = cliOptions(["show", "tools"], provider);

    await expect(runCli(options)).resolves.toBe(0);

    expect(provider.requests[0]?.tools?.map(tool => tool.name)).toContain("TodoWrite");
  });

  it("registers agent in the default CLI agent", async () => {
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "ready" }])
    );
    const { options } = cliOptions(["show", "tools"], provider);

    await expect(runCli(options)).resolves.toBe(0);

    expect(provider.requests[0]?.tools?.map(tool => tool.name)).toContain("agent");
  });

  it("prints todo updates from the default CLI agent", async () => {
    const { options, stdout, stderr } = cliOptions(
      ["track", "progress"],
      new MockModelProvider([
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
        { type: "response", content: "Tracking progress." }
      ])
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("[tool] TodoWrite");
    expect(stdout.output).toContain("[todo]\n  - in_progress: Run tests\n");
    expect(stdout.output).toContain("Tracking progress.");
    expect(stderr.output).toBe("");
  });

  it("restores todo state from a saved session", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-todo-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot });
    await createStore(process.cwd()).save(
      [
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
      ],
      sessionId
    );
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "continued" }])
    );
    const { options, stdout, stderr } = cliOptions(
      ["--resume", sessionId, "continue"],
      provider,
      undefined,
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stdout.output).toContain("continued");
    expect(stderr.output).toBe("");
    expect(provider.requests[0]?.messages).toContainEqual({
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
    });
  });

  it("registers the platform command tool in the default CLI agent", async () => {
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "ready" }])
    );
    const { options } = cliOptions(
      ["show", "tools"],
      provider,
      undefined,
      undefined,
      () => Promise.resolve({ kind: "completed", stdout: "", stderr: "", exitCode: 0 })
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(provider.requests[0]?.tools?.map(tool => tool.name)).toContain("powershell");
  });

  it("runs explore sub-agents in read-only mode", async () => {
    const { options, stdout, stderr } = cliOptions(
      ["--permission-mode", "read-only", "inspect", "auth"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "agent",
              input: {
                description: "inspect-auth",
                prompt: "Inspect auth.",
                subagent_type: "explore"
              }
            }
          ]
        },
        { type: "response", content: "explore done" },
        { type: "response", content: "Parent saw result." }
      ])
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("[tool] agent");
    expect(stdout.output).toContain("[tool result] [Sub-agent completed]\nexplore done");
    expect(stdout.output).toContain("Parent saw result.");
    expect(stderr.output).toBe("");
  });

  it("asks before file writes in default mode and honors rejection", async () => {
    await writeFile("cli-write-fixture.txt", "before\n", "utf8");
    const { options, stdout, stderr } = cliOptions(
      ["change", "fixture"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-write-fixture.txt", content: "after\n" }
            }
          ]
        },
        { type: "response", content: "Write was blocked." }
      ]),
      ["n"]
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(readFile("cli-write-fixture.txt", "utf8")).resolves.toBe("before\n");
    } finally {
      await rm("cli-write-fixture.txt", { force: true });
    }

    expect(stdout.output).toContain("[tool] write_file");
    expect(stdout.output).toContain("Approval required for write_file");
    expect(stdout.output).toContain("Write was blocked.");
    expect(stderr.output).toContain("User rejected the request.");
  });

  it("permits one file write after default-mode approval", async () => {
    await writeFile("cli-write-fixture.txt", "before\n", "utf8");
    const { options, stdout, stderr } = cliOptions(
      ["change", "fixture"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-write-fixture.txt", content: "after\n" }
            }
          ]
        },
        { type: "response", content: "Write completed." }
      ]),
      ["y"]
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(readFile("cli-write-fixture.txt", "utf8")).resolves.toBe("after\n");
    } finally {
      await rm("cli-write-fixture.txt", { force: true });
    }

    expect(stdout.output).toContain("Approval required for write_file");
    expect(stdout.output).toContain("[tool result]");
    expect(stdout.output).toContain("Write completed.");
    expect(stderr.output).toBe("");
  });

  it("allows later writes of the same tool in the current REPL session", async () => {
    await writeFile("cli-write-fixture.txt", "before\n", "utf8");
    const { options, stdout, stderr } = cliOptions(
      [],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-write-fixture.txt", content: "first\n" }
            }
          ]
        },
        { type: "response", content: "First write completed." },
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_2",
              name: "write_file",
              input: { file_path: "cli-write-fixture.txt", content: "second\n" }
            }
          ]
        },
        { type: "response", content: "Second write completed." }
      ]),
      ["first change", "a", "second change", "exit"]
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(readFile("cli-write-fixture.txt", "utf8")).resolves.toBe("second\n");
    } finally {
      await rm("cli-write-fixture.txt", { force: true });
    }

    const matches = stdout.output.match(/Approval required for write_file/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(stdout.output).toContain("First write completed.");
    expect(stdout.output).toContain("Second write completed.");
    expect(stderr.output).toBe("");
  });

  it("permits file writes after explicit allow-all selection", async () => {
    await writeFile("cli-write-fixture.txt", "before\n", "utf8");
    const { options, stdout, stderr } = cliOptions(
      ["--permission-mode", "allow-all", "change", "fixture"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-write-fixture.txt", content: "after\n" }
            }
          ]
        },
        { type: "response", content: "Write completed." }
      ])
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(readFile("cli-write-fixture.txt", "utf8")).resolves.toBe("after\n");
    } finally {
      await rm("cli-write-fixture.txt", { force: true });
    }

    expect(stdout.output).toContain("[tool result]");
    expect(stdout.output).toContain("Write completed.");
    expect(stderr.output).toBe("");
  });

  it("asks before a local command and runs it only after one-time approval", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "tests passed\n", stderr: "", exitCode: 0 })
    );
    const { options, stdout, stderr } = cliOptions(
      ["run", "tests"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_1", name: "powershell", input: { command: "bun run test" } }
          ]
        },
        { type: "response", content: "Tests completed." }
      ]),
      ["y"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("Approval required for powershell");
    expect(stdout.output).toContain('Command: "bun run test"');
    expect(stdout.output).toContain('Suggested prefix: "bun run"');
    expect(stdout.output).toContain("[y] once  [p] this prefix for this process  [n] reject");
    expect(stdout.output).toContain("[tool result] tests passed");
    expect(stderr.output).toBe("");
    expect(runner).toHaveBeenCalledOnce();
  });

  it("reuses an approved command prefix within the current process", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "ok\n", stderr: "", exitCode: 0 })
    );
    const { options, stdout, stderr } = cliOptions(
      [],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_1", name: "powershell", input: { command: "bun run test" } }
          ]
        },
        { type: "response", content: "First command completed." },
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_2", name: "powershell", input: { command: "bun run build" } }
          ]
        },
        { type: "response", content: "Second command completed." }
      ]),
      ["first", "p", "second", "exit"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    const prompts = stdout.output.match(/Approval required for powershell/g) ?? [];
    expect(prompts).toHaveLength(1);
    expect(stdout.output).toContain("First command completed.");
    expect(stdout.output).toContain("Second command completed.");
    expect(stderr.output).toBe("");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("does not offer prefix approval for blocked command prefixes", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "bad", stderr: "", exitCode: 0 })
    );
    const { options, stdout, stderr } = cliOptions(
      ["run", "command"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_1", name: "powershell", input: { command: "powershell -Command bad" } }
          ]
        },
        { type: "response", content: "Command rejected." }
      ]),
      ["p", "n"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("No reusable prefix is suggested");
    expect(stdout.output).toContain("Allow? [y] once  [n] reject");
    expect(stdout.output).toContain("Command tools only support y (allow once) or n (reject) for this command.");
    expect(stderr.output).toContain("User rejected the request.");
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not accept session-wide approval for local commands", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "bad", stderr: "", exitCode: 0 })
    );
    const { options, stdout, stderr } = cliOptions(
      ["run", "command"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            { id: "call_1", name: "powershell", input: { command: "Write-Output no" } }
          ]
        },
        { type: "response", content: "Command rejected." }
      ]),
      ["a", "n"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain("Enter y to allow once, p to allow this command prefix for this process, or n to reject.");
    expect(stderr.output).toContain("User rejected the request.");
    expect(runner).not.toHaveBeenCalled();
  });

  it("shows the complete command text before asking for approval", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "ok", stderr: "", exitCode: 0 })
    );
    const suffix = "Write-Output visible-end";
    const command = `${"Write-Output prefix; ".repeat(8)}${suffix}`;
    const { options, stdout } = cliOptions(
      ["run", "long", "command"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "powershell", input: { command } }]
        },
        { type: "response", content: "Rejected." }
      ]),
      ["n"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    expect(stdout.output).toContain(suffix);
    expect(stdout.output).not.toContain("...");
    expect(runner).not.toHaveBeenCalled();
  });

  it("asks again for a second local command after approving the first", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "ok\n", stderr: "", exitCode: 0 })
    );
    const { options, stdout, stderr } = cliOptions(
      [],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "powershell", input: { command: "first" } }]
        },
        { type: "response", content: "First done." },
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_2", name: "powershell", input: { command: "second" } }]
        },
        { type: "response", content: "Second rejected." }
      ]),
      ["run first", "y", "run second", "n", "exit"],
      undefined,
      runner
    );

    await expect(runCli(options)).resolves.toBe(0);

    const prompts = stdout.output.match(/Approval required for powershell/g) ?? [];
    expect(prompts).toHaveLength(2);
    expect(runner).toHaveBeenCalledOnce();
    expect(stderr.output).toContain("User rejected the request.");
  });

  it("applies read-only and allow-all modes to local commands", async () => {
    const runner = vi.fn<CommandRunner>(() =>
      Promise.resolve({ kind: "completed", stdout: "allowed\n", stderr: "", exitCode: 0 })
    );
    const denied = cliOptions(
      ["--permission-mode", "read-only", "run"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_1", name: "powershell", input: { command: "denied" } }]
        },
        { type: "response", content: "Denied." }
      ]),
      undefined,
      undefined,
      runner
    );
    const allowed = cliOptions(
      ["--permission-mode", "allow-all", "run"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [{ id: "call_2", name: "powershell", input: { command: "allowed" } }]
        },
        { type: "response", content: "Allowed." }
      ]),
      undefined,
      undefined,
      runner
    );

    await expect(runCli(denied.options)).resolves.toBe(0);
    expect(runner).not.toHaveBeenCalled();
    expect(denied.stderr.output).toContain("CLI is running in read-only mode.");

    await expect(runCli(allowed.options)).resolves.toBe(0);
    expect(runner).toHaveBeenCalledOnce();
    expect(allowed.stdout.output).not.toContain("Approval required for powershell");
    expect(allowed.stdout.output).toContain("[tool result] allowed");
  });

  it("rejects invalid permission mode before creating a provider", async () => {
    const stdout = createWritable();
    const stderr = createWritable();
    const createProvider = vi.fn(() => new MockModelProvider([]));

    await expect(
      runCli({
        args: ["--permission-mode", "unknown", "hello"],
        stdin: new PassThrough(),
        stdout,
        stderr,
        createProvider
      })
    ).resolves.toBe(1);

    expect(createProvider).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain('Invalid permission mode "unknown"');
  });

  it("saves and lists sessions through REPL commands while reusing the same id", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-session-"));
    let savedAtIndex = 0;
    const createStore = (workspaceRoot: string) =>
      createSessionStore({
        storageRoot,
        workspaceRoot,
        createId: () => sessionId,
        now: () =>
          new Date(
            ["2026-05-26T08:00:00.000Z", "2026-05-26T09:00:00.000Z"][savedAtIndex++]!
          )
      });
    const { options, stdout, stderr } = cliOptions(
      [],
      new MockModelProvider([{ type: "response", content: "answer" }]),
      ["question", "/save", "/save", "/sessions", "exit"],
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      const sessions = await createStore(process.cwd()).list();
      expect(sessions).toEqual([
        {
          id: sessionId,
          savedAt: "2026-05-26T09:00:00.000Z",
          preview: "question",
          messageCount: 2
        }
      ]);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stdout.output.match(new RegExp(`Session saved: ${sessionId}`, "g"))).toHaveLength(2);
    expect(stdout.output).toContain("Saved sessions:");
    expect(stdout.output).toContain("question");
    expect(stderr.output).toBe("");
  });

  it("does not create a session when saving an empty REPL", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-empty-session-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot, createId: () => sessionId });
    const { options, stdout } = cliOptions(
      [],
      new MockModelProvider([]),
      ["/save", "exit"],
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(createStore(process.cwd()).list()).resolves.toEqual([]);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stdout.output).toContain("Nothing to save. Start a conversation first.");
  });

  it("resumes saved messages before running a new prompt", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-resume-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot });
    await createStore(process.cwd()).save(
      [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" }
      ],
      sessionId
    );
    const provider = new RecordingProvider(
      new MockModelProvider([{ type: "response", content: "continued" }])
    );
    const { options, stdout, stderr } = cliOptions(
      ["--resume", sessionId, "continue"],
      provider,
      undefined,
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(provider.requests[0]?.messages.slice(-3)).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "continue" }
    ]);
    expect(stdout.output).toContain("continued");
    expect(stderr.output).toBe("");
  });

  it("rejects a missing resumed session before creating a provider", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-missing-"));
    const stdout = createWritable();
    const stderr = createWritable();
    const createProvider = vi.fn(() => new MockModelProvider([]));

    try {
      await expect(
        runCli({
          args: ["--resume", sessionId],
          stdin: new PassThrough(),
          stdout,
          stderr,
          createProvider,
          createSessionStore: workspaceRoot =>
            createSessionStore({ storageRoot, workspaceRoot })
        })
      ).resolves.toBe(1);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(createProvider).not.toHaveBeenCalled();
    expect(stderr.output).toContain(`Session "${sessionId}" was not found`);
  });

  it("keeps restored sessions read-only when read-only is selected again", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-permission-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({ storageRoot, workspaceRoot });
    await createStore(process.cwd()).save([{ role: "user", content: "prior write" }], sessionId);
    await writeFile("cli-resume-write-fixture.txt", "before\n", "utf8");
    const { options, stderr } = cliOptions(
      ["--resume", sessionId, "--permission-mode", "read-only", "write", "again"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-resume-write-fixture.txt", content: "after\n" }
            }
          ]
        },
        { type: "response", content: "blocked" }
      ]),
      undefined,
      createStore
    );

    try {
      await expect(runCli(options)).resolves.toBe(0);
      await expect(readFile("cli-resume-write-fixture.txt", "utf8")).resolves.toBe("before\n");
    } finally {
      await rm("cli-resume-write-fixture.txt", { force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(stderr.output).toContain("CLI is running in read-only mode.");
  });

  it("does not restore default-mode session approvals from a saved conversation", async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-cli-approval-"));
    const createStore = (workspaceRoot: string) =>
      createSessionStore({
        storageRoot,
        workspaceRoot,
        createId: () => sessionId
      });
    await writeFile("cli-resume-write-fixture.txt", "before\n", "utf8");
    const first = cliOptions(
      [],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              input: { file_path: "cli-resume-write-fixture.txt", content: "first\n" }
            }
          ]
        },
        { type: "response", content: "saved" }
      ]),
      ["write", "a", "/save", "exit"],
      createStore
    );
    const second = cliOptions(
      ["--resume", sessionId, "write", "again"],
      new MockModelProvider([
        {
          type: "response",
          content: "",
          stopReason: "tool_use",
          toolCalls: [
            {
              id: "call_2",
              name: "write_file",
              input: { file_path: "cli-resume-write-fixture.txt", content: "second\n" }
            }
          ]
        },
        { type: "response", content: "rejected" }
      ]),
      ["n"],
      createStore
    );

    try {
      await expect(runCli(first.options)).resolves.toBe(0);
      await expect(readFile("cli-resume-write-fixture.txt", "utf8")).resolves.toBe("first\n");

      await expect(runCli(second.options)).resolves.toBe(0);
      await expect(readFile("cli-resume-write-fixture.txt", "utf8")).resolves.toBe("first\n");
    } finally {
      await rm("cli-resume-write-fixture.txt", { force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }

    expect(second.stdout.output).toContain("Approval required for write_file");
    expect(second.stderr.output).toContain("User rejected the request.");
  });

  it("prints a clear error when the default provider has no API key", async () => {
    vi.stubEnv("MINI_CCODE_API_KEY", undefined);

    const stdout = createWritable();
    const stderr = createWritable();

    await expect(
      runCli({
        args: ["hello"],
        stdin: new PassThrough(),
        stdout,
        stderr
      })
    ).resolves.toBe(1);

    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Missing MINI_CCODE_API_KEY");
  });
});
