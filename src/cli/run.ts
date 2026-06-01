import { Agent } from "../agent/index.js";
import { createCommandTools } from "../command-tools/index.js";
import { createContextManager, createProviderContextSummarizer } from "../context/index.js";
import { createFileTools } from "../file-tools/index.js";
import { createInstructionContext } from "../instructions/index.js";
import {
  createOpenAICompatibleProviderFromEnv,
  ModelProviderError,
  type LanguageModelProvider
} from "../llm/index.js";
import { ToolRegistry, type Tool } from "../tools/index.js";
import { createTodoState, createTodoTools, extractTodosFromMessages } from "../todo/index.js";
import {
  createDefaultSessionStore,
  SessionStoreError,
  type SessionId,
  type SessionStore
} from "../session/index.js";
import { createSubAgentTools } from "../sub-agent/index.js";
import { parseCliInput } from "./input.js";
import { createCliInputReader, type CliInputReader } from "./input-reader.js";
import { parseCliArgs, type CliPermissionMode } from "./options.js";
import { createCliPermissionRuntime } from "./permission.js";
import { renderAgentEvent, renderHelp, type CliOutput } from "./render.js";

export type CliMode = "one-shot" | "repl";

export type CliOptions = {
  readonly args: readonly string[];
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream & { readonly isTTY?: boolean };
  readonly stderr: NodeJS.WritableStream;
  readonly createProvider?: () => LanguageModelProvider;
  readonly createSessionStore?: (workspaceRoot: string) => SessionStore;
  readonly createCommandTools?: (workspaceRoot: string) => readonly Tool[];
  readonly lineSource?: AsyncIterable<string> | Iterable<string>;
};

export async function runCli(options: CliOptions): Promise<number> {
  const output = outputFromStreams(options.stdout, options.stderr);
  const parsedArgs = parseCliArgs(options.args);

  if (!parsedArgs.ok) {
    output.writeStderr(`${parsedArgs.message}\n`);
    return 1;
  }

  const sessionStore =
    options.createSessionStore?.(process.cwd()) ?? createDefaultSessionStore(process.cwd());
  const savedSession = await loadSavedSession(parsedArgs.resumeSessionId, sessionStore, output);
  if (savedSession === false) {
    return 1;
  }

  const provider = createProviderForCli(options, output);

  if (provider === undefined) {
    return 1;
  }

  const input = createCliInputReader(options);
  const permission = createCliPermissionRuntime({
    mode: parsedArgs.permissionMode,
    input,
    output
  });
  const workspaceRoot = process.cwd();
  const todoState = createTodoState(extractTodosFromMessages(savedSession?.messages ?? []));
  const commandTools =
    options.createCommandTools?.(workspaceRoot) ?? createCommandTools({ workspaceRoot });
  const baseTools = [
    ...createTodoTools(todoState),
    ...createFileTools({ workspaceRoot }),
    ...commandTools
  ];
  const tools = [
    ...baseTools,
    ...createSubAgentTools({
      provider,
      workspaceRoot,
      parentTools: baseTools,
      permissionPolicy: permission.policy,
      ...(permission.requestPermission === undefined
        ? {}
        : { requestPermission: permission.requestPermission }),
      createContextManager: () =>
        createContextManager({
          summarizer: createProviderContextSummarizer(provider),
          maxEstimatedTokens: parsedArgs.contextLimit
        }),
      todoState
    })
  ];
  let instructions;
  try {
    instructions = await createInstructionContext({
      workspaceRoot,
      tools,
      permissionMode: parsedArgs.permissionMode,
      ...(parsedArgs.systemPrompt === undefined
        ? {}
        : { systemPrompt: parsedArgs.systemPrompt }),
      ...(parsedArgs.appendSystemPrompt === undefined
        ? {}
        : { appendSystemPrompt: parsedArgs.appendSystemPrompt })
    });
  } catch (error) {
    output.writeStderr(`Error: ${errorMessage(error)}\n`);
    return 1;
  }
  const contextManager = createContextManager({
    summarizer: createProviderContextSummarizer(provider),
    maxEstimatedTokens: parsedArgs.contextLimit
  });
  const agent = new Agent({
    provider,
    tools: new ToolRegistry(tools),
    permissionPolicy: permission.policy,
    ...(permission.requestPermission === undefined
      ? {}
      : { requestPermission: permission.requestPermission }),
    systemPrompt: instructions.systemPrompt,
    contextMessages: instructions.contextMessages,
    ...(savedSession === undefined ? {} : { initialMessages: savedSession.messages }),
    contextManager,
    todoState
  });

  try {
    if (parsedArgs.prompt.length > 0) {
      return await runPrompt(agent, parsedArgs.prompt, output, true);
    }

    return await runRepl(
      agent,
      parsedArgs.permissionMode,
      sessionStore,
      savedSession?.id,
      input,
      output
    );
  } finally {
    input.close();
  }
}

async function runRepl(
  agent: Agent,
  permissionMode: CliPermissionMode,
  sessionStore: SessionStore,
  resumedSessionId: SessionId | undefined,
  inputReader: CliInputReader,
  output: CliOutput
): Promise<number> {
  let activeSessionId = resumedSessionId;
  output.writeStdout(
    `mini-ccode\n${permissionModeDescription(permissionMode)}\nType /help for commands, exit to quit.\n`
  );
  if (resumedSessionId !== undefined) {
    output.writeStdout(`Resumed session: ${resumedSessionId}\n`);
  }

  while (true) {
    let line: string | undefined;
    try {
      line = await inputReader.question("mini-ccode> ");
    } catch (error) {
      output.writeStderr(`Error: ${errorMessage(error)}\n`);
      break;
    }

    if (line === undefined) {
      break;
    }

    const input = parseCliInput(line);

    if (input.type === "empty") {
      continue;
    }

    if (input.type === "exit") {
      output.writeStdout("bye\n");
      return 0;
    }

    if (input.type === "help") {
      renderHelp(output);
      continue;
    }

    if (input.type === "compact") {
      try {
        const result = await agent.compactContext();
        if (result === undefined) {
          output.writeStdout("[context] Nothing to compact yet.\n");
        } else {
          output.writeStdout(
            `[context] Compacted context: estimated ${result.estimatedTokensBefore} -> ${result.estimatedTokensAfter} tokens.\n`
          );
        }
      } catch (error) {
        output.writeStderr(`Error: ${errorMessage(error)}\n`);
      }
      continue;
    }

    if (input.type === "reset") {
      agent.reset();
      output.writeStdout("Conversation reset.\n");
      continue;
    }

    if (input.type === "save") {
      if (agent.getMessages().length === 0) {
        output.writeStdout("Nothing to save. Start a conversation first.\n");
        continue;
      }

      try {
        const summary = await sessionStore.save(agent.getMessages(), activeSessionId);
        activeSessionId = summary.id;
        output.writeStdout(`Session saved: ${summary.id}\n`);
        output.writeStdout(
          `Resume with: bun run mini-ccode -- --resume ${summary.id}\n`
        );
      } catch (error) {
        output.writeStderr(`Error: ${errorMessage(error)}\n`);
      }
      continue;
    }

    if (input.type === "sessions") {
      try {
        const sessions = await sessionStore.list();
        if (sessions.length === 0) {
          output.writeStdout("No saved sessions for this workspace.\n");
        } else {
          output.writeStdout("Saved sessions:\n");
          for (const session of sessions) {
            output.writeStdout(
              `  ${session.id}  ${session.savedAt}  ${session.preview}\n`
            );
          }
        }
      } catch (error) {
        output.writeStderr(`Error: ${errorMessage(error)}\n`);
      }
      continue;
    }

    const exitCode = await runPrompt(agent, input.text, output, false);
    if (exitCode !== 0) {
      continue;
    }
  }

  output.writeStdout("\nbye\n");
  return 0;
}

async function loadSavedSession(
  sessionId: SessionId | undefined,
  sessionStore: SessionStore,
  output: CliOutput
): Promise<Awaited<ReturnType<SessionStore["load"]>> | false> {
  if (sessionId === undefined) {
    return undefined;
  }

  try {
    const session = await sessionStore.load(sessionId);
    if (session === undefined) {
      output.writeStderr(`Session "${sessionId}" was not found in this workspace.\n`);
      return false;
    }

    return session;
  } catch (error) {
    const message =
      error instanceof SessionStoreError ? error.message : `Unable to load session "${sessionId}".`;
    output.writeStderr(`Error: ${message}\n`);
    return false;
  }
}

async function runPrompt(
  agent: Agent,
  prompt: string,
  output: CliOutput,
  returnErrorCode: boolean
): Promise<number> {
  let exitCode = 0;

  for await (const event of agent.runStream(prompt)) {
    renderAgentEvent(event, output);

    if (event.type === "turn_end" && event.reason !== "completed") {
      exitCode = 1;
    }
  }

  return returnErrorCode ? exitCode : 0;
}

function createProviderForCli(
  options: CliOptions,
  output: CliOutput
): LanguageModelProvider | undefined {
  try {
    if (options.createProvider === undefined && process.env.MINI_CCODE_API_KEY === undefined) {
      output.writeStderr(
        "Missing MINI_CCODE_API_KEY.\nSet MINI_CCODE_API_KEY and optionally MINI_CCODE_BASE_URL / MINI_CCODE_MODEL.\n"
      );
      return undefined;
    }

    return options.createProvider?.() ?? createOpenAICompatibleProviderFromEnv();
  } catch (error) {
    if (error instanceof ModelProviderError && error.providerError.code === "missing_api_key") {
      output.writeStderr(
        "Missing MINI_CCODE_API_KEY.\nSet MINI_CCODE_API_KEY and optionally MINI_CCODE_BASE_URL / MINI_CCODE_MODEL.\n"
      );
      return undefined;
    }

    output.writeStderr(`Error: ${errorMessage(error)}\n`);
    return undefined;
  }
}

function outputFromStreams(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): CliOutput {
  return {
    writeStdout: text => {
      stdout.write(text);
    },
    writeStderr: text => {
      stderr.write(text);
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function permissionModeDescription(mode: CliPermissionMode): string {
  if (mode === "default") {
    return "Permission mode: default (asks before file changes and local commands)";
  }
  if (mode === "read-only") {
    return "Permission mode: read-only (denies file changes and local commands)";
  }
  return "Permission mode: allow-all (allows file changes and local commands without prompting)";
}
