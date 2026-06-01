import type { ToolRegistry } from "./registry.js";
import type {
  Tool,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionError,
  ToolExecutionResult,
  ToolResult
} from "./types.js";
import { allowAllPermissionPolicy } from "../permission/index.js";
import { validateToolInput } from "./validation.js";

export async function executeToolCall(
  registry: ToolRegistry,
  call: ToolCall,
  context: ToolExecutionContext = {}
): Promise<ToolExecutionResult> {
  const tool = registry.get(call.name);

  if (tool === undefined) {
    return {
      callId: call.id,
      toolName: call.name,
      ok: false,
      error: {
        code: "unknown_tool",
        message: `Unknown tool "${call.name}".`
      }
    };
  }

  const validationError = validateToolInput(tool.inputSchema, call.input);
  if (validationError !== undefined) {
    return {
      callId: call.id,
      toolName: tool.name,
      ok: false,
      error: validationError
    };
  }

  const permissionResult = await decidePermission(tool, call.input, context);
  if (permissionResult !== undefined) {
    return {
      callId: call.id,
      toolName: tool.name,
      ok: false,
      error: permissionResult
    };
  }

  try {
    const result = await tool.execute(call.input, context);
    return fromToolResult(call.id, tool.name, result);
  } catch (error) {
    return {
      callId: call.id,
      toolName: tool.name,
      ok: false,
      error: {
        code: "execution_error",
        message: error instanceof Error ? error.message : "Tool execution failed."
      }
    };
  }
}

async function decidePermission(
  tool: Tool,
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext
): Promise<ToolExecutionError | undefined> {
  const policy = context.permissionPolicy ?? allowAllPermissionPolicy();

  try {
    const decision = await policy.decide({ tool, input, context });

    if (decision.behavior === "allow") {
      return undefined;
    }

    if (decision.behavior === "ask") {
      if (context.requestPermission === undefined) {
        return {
          code: "permission_denied",
          message: `Permission required for tool "${tool.name}": ${decision.reason}`
        };
      }

      try {
        const approval = await context.requestPermission({ tool, input, context });
        if (approval.behavior === "allow") {
          return undefined;
        }

        return {
          code: "permission_denied",
          message: `Permission denied for tool "${tool.name}": ${approval.reason ?? decision.reason}`
        };
      } catch {
        return {
          code: "permission_denied",
          message: `Permission approval failed for tool "${tool.name}".`
        };
      }
    }

    return {
      code: "permission_denied",
      message: `Permission denied for tool "${tool.name}": ${decision.reason}`
    };
  } catch {
    return {
      code: "permission_denied",
      message: `Permission check failed for tool "${tool.name}".`
    };
  }
}

function fromToolResult(
  callId: string,
  toolName: string,
  result: ToolResult
): ToolExecutionResult {
  if (result.ok) {
    return {
      callId,
      toolName,
      ok: true,
      content: result.content,
      ...(result.metadata === undefined ? {} : { metadata: result.metadata })
    };
  }

  return {
    callId,
    toolName,
    ok: false,
    error: result.error
  };
}
