import type { AgentMessage } from "../agent/types.js";
import type { ModelToolCall } from "../llm/index.js";
import { parseTodoList } from "./validation.js";
import type { TodoList, TodoState } from "./types.js";
import { todoMainOwnerId, todoWriteToolName } from "./types.js";

export function createTodoState(initialTodos: TodoList = []): TodoState {
  const todosByOwner = new Map<string, TodoList>([[todoMainOwnerId, [...initialTodos]]]);

  return {
    getTodos: (ownerId = todoMainOwnerId) =>
      (todosByOwner.get(ownerId) ?? []).map(todo => ({ ...todo })),
    setTodos: (nextTodos, ownerId = todoMainOwnerId) => {
      todosByOwner.set(ownerId, [...nextTodos]);
    },
    getAllTodos: () => {
      const result: Record<string, TodoList> = {};
      for (const [ownerId, todos] of todosByOwner) {
        result[ownerId] = todos.map(todo => ({ ...todo }));
      }
      return result;
    },
    reset: () => {
      todosByOwner.clear();
      todosByOwner.set(todoMainOwnerId, []);
    }
  };
}

export function extractTodosFromMessages(messages: readonly AgentMessage[]): TodoList {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant" || message.toolCalls === undefined) {
      continue;
    }

    const todos = extractTodosFromToolCalls(message.toolCalls);
    if (todos !== undefined) {
      return todos;
    }
  }

  return [];
}

function extractTodosFromToolCalls(
  toolCalls: readonly ModelToolCall[]
): TodoList | undefined {
  for (let callIndex = toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
    const call = toolCalls[callIndex];
    if (call?.name !== todoWriteToolName) {
      continue;
    }

    return parseTodoList(call.input.todos) ?? [];
  }

  return undefined;
}
