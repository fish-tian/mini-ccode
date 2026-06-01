import { defineTool, type Tool, type ToolResult } from "../tools/index.js";
import { parseTodoList } from "./validation.js";
import type { TodoState } from "./types.js";
import { todoMainOwnerId, todoWriteToolName } from "./types.js";

export function createTodoWriteTool(
  state: TodoState,
  options: { readonly ownerId?: string } = {}
): Tool {
  const ownerId = options.ownerId ?? todoMainOwnerId;
  return defineTool({
    name: todoWriteToolName,
    description:
      "Update the todo list for the current coding session. Use it for multi-step work and progress tracking.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The updated todo list.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "Imperative description of what needs to be done."
              },
              activeForm: {
                type: "string",
                description: "Present-continuous description shown while running."
              },
              status: {
                type: "string",
                description: "One of pending, in_progress, or completed."
              }
            },
            required: ["content", "activeForm", "status"]
          }
        }
      },
      required: ["todos"]
    },
    isReadOnly: true,
    isConcurrencySafe: false,
    execute: input => {
      const parsed = parseTodoList(input.todos);
      if (parsed === undefined) {
        return invalidTodoInput();
      }

      const allDone = parsed.length > 0 && parsed.every(todo => todo.status === "completed");
      state.setTodos(allDone ? [] : parsed, ownerId);

      return {
        ok: true,
        content:
          "Todos updated. Continue using the todo list to track progress.",
        metadata: {
          ownerId,
          todos: state.getTodos(ownerId)
        }
      };
    }
  });
}

export function createTodoTools(
  state: TodoState,
  options: { readonly ownerId?: string } = {}
): readonly Tool[] {
  return [createTodoWriteTool(state, options)];
}

function invalidTodoInput(): ToolResult {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message:
        "TodoWrite requires todos with non-empty content, non-empty activeForm, and status pending, in_progress, or completed."
    }
  };
}
