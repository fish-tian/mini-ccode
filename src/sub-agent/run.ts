import { Agent, type AgentEvent } from "../agent/index.js";
import { createFileTools } from "../file-tools/index.js";
import { ToolRegistry, type Tool } from "../tools/index.js";
import { createTodoWriteTool } from "../todo/index.js";
import { buildSubAgentSystemPrompt } from "./prompt.js";
import { truncateSubAgentResult } from "./result.js";
import type { SubAgentInput, SubAgentRunResult, SubAgentToolOptions } from "./types.js";

const readOnlyFileToolNames = new Set(["read_file", "glob", "grep"]);

export async function runSubAgent(
  input: SubAgentInput,
  options: SubAgentToolOptions,
  signal?: AbortSignal
): Promise<SubAgentRunResult> {
  const tools = createToolsForSubAgent(input, options);
  const child = new Agent({
    provider: options.provider,
    tools: new ToolRegistry(tools),
    ...(options.permissionPolicy === undefined ? {} : { permissionPolicy: options.permissionPolicy }),
    ...(options.requestPermission === undefined ? {} : { requestPermission: options.requestPermission }),
    systemPrompt: buildSubAgentSystemPrompt(input.subagentType),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.createContextManager === undefined
      ? {}
      : { contextManager: options.createContextManager() }),
    ...(options.todoState === undefined ? {} : { todoState: options.todoState })
  });

  let content = "";
  let stopReason = "provider_error";

  for await (const event of child.runStream(input.prompt, signal === undefined ? {} : { signal })) {
    options.onEvent?.(event);
    if (event.type === "model_response") {
      content = event.response.content;
    }
    if (event.type === "turn_end") {
      stopReason = event.reason;
    }
  }

  if (stopReason !== "completed") {
    return { ok: false, message: stopReasonMessage(stopReason) };
  }

  return {
    ok: true,
    content: truncateSubAgentResult(content, options.maxResultChars)
  };
}

export function createToolsForSubAgent(
  input: SubAgentInput,
  options: Pick<SubAgentToolOptions, "parentTools" | "workspaceRoot" | "todoState">
): readonly Tool[] {
  if (input.subagentType === "explore") {
    return createFileTools(
      options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }
    ).filter(tool => readOnlyFileToolNames.has(tool.name));
  }

  const ownerId = subAgentTodoOwnerId(input.description);
  return options.parentTools
    .filter(tool => tool.name !== "agent")
    .flatMap(tool => {
      if (tool.name !== "TodoWrite") {
        return [tool];
      }
      if (options.todoState === undefined) {
        return [];
      }
      return createTodoWriteTool(options.todoState, { ownerId });
    });
}

export function forwardSubAgentEvent(
  description: string,
  event: AgentEvent,
  emit: ((event: { readonly type: "sub_agent_event"; readonly description: string; readonly event: AgentEvent }) => void) | undefined
): void {
  emit?.({ type: "sub_agent_event", description, event });
}

function subAgentTodoOwnerId(description: string): `subagent:${string}` {
  return `subagent:${slugifyDescription(description)}`;
}

function slugifyDescription(description: string): string {
  const slug = description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length === 0 ? "agent" : slug;
}

function stopReasonMessage(stopReason: string): string {
  if (stopReason === "max_turns") {
    return "reached maximum turns";
  }
  if (stopReason === "aborted") {
    return "aborted";
  }
  return stopReason.replaceAll("_", " ");
}
