import { defineTool, type Tool, type ToolExecutionContext, type ToolResult } from "../tools/index.js";
import { formatSubAgentError, formatSubAgentSuccess } from "./result.js";
import { forwardSubAgentEvent, runSubAgent } from "./run.js";
import type { SubAgentInput, SubAgentToolOptions, SubAgentType } from "./types.js";

export const subAgentToolName = "agent";

export function createSubAgentTool(options: SubAgentToolOptions): Tool {
  return defineTool({
    name: subAgentToolName,
    description:
      "Start a synchronous sub-agent with an independent context. Use general for implementation tasks and explore for read-only research.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short description for display."
        },
        prompt: {
          type: "string",
          description: "Complete task instructions for the sub-agent."
        },
        subagent_type: {
          type: "string",
          description: "Optional sub-agent type: general or explore."
        }
      },
      required: ["description", "prompt"]
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    execute: (input, context) => executeSubAgentTool(input, options, context)
  });
}

export function createSubAgentTools(options: SubAgentToolOptions): readonly Tool[] {
  return [createSubAgentTool(options)];
}

function executeSubAgentTool(
  rawInput: Readonly<Record<string, unknown>>,
  options: SubAgentToolOptions,
  context: ToolExecutionContext
): Promise<ToolResult> | ToolResult {
  const input = parseSubAgentInput(rawInput);
  if (input === undefined) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message:
          "agent requires non-empty description, non-empty prompt, and subagent_type general or explore."
      }
    };
  }

  const runOptions: SubAgentToolOptions = {
    ...options,
    ...(context.permissionPolicy === undefined
      ? {}
      : { permissionPolicy: context.permissionPolicy }),
    ...(context.requestPermission === undefined
      ? {}
      : { requestPermission: context.requestPermission }),
    onEvent: event => {
      options.onEvent?.(event);
      forwardSubAgentEvent(input.description, event, context.emitEvent);
    }
  };

  return runSubAgent(input, runOptions, context.signal).then(result => {
    if (!result.ok) {
      return { ok: true, content: formatSubAgentError(result.message) };
    }

    return { ok: true, content: formatSubAgentSuccess(result.content) };
  });
}

export function parseSubAgentInput(
  rawInput: Readonly<Record<string, unknown>>
): SubAgentInput | undefined {
  if (typeof rawInput.description !== "string" || rawInput.description.trim() === "") {
    return undefined;
  }

  if (typeof rawInput.prompt !== "string" || rawInput.prompt.trim() === "") {
    return undefined;
  }

  const subagentType = parseSubAgentType(rawInput.subagent_type);
  if (subagentType === undefined) {
    return undefined;
  }

  return {
    description: rawInput.description.trim(),
    prompt: rawInput.prompt.trim(),
    subagentType
  };
}

function parseSubAgentType(value: unknown): SubAgentType | undefined {
  if (value === undefined) {
    return "general";
  }
  if (value === "general" || value === "explore") {
    return value;
  }
  return undefined;
}
