import type { TodoItem, TodoList, TodoStatus } from "./types.js";

const todoStatuses = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

export function parseTodoList(value: unknown): TodoList | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const todos: TodoItem[] = [];

  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }

    const record = item as Readonly<Record<string, unknown>>;
    const content = record.content;
    const activeForm = record.activeForm;
    const status = record.status;

    if (typeof content !== "string" || content.trim().length === 0) {
      return undefined;
    }

    if (typeof activeForm !== "string" || activeForm.trim().length === 0) {
      return undefined;
    }

    if (typeof status !== "string" || !todoStatuses.has(status as TodoStatus)) {
      return undefined;
    }

    todos.push({
      content,
      activeForm,
      status: status as TodoStatus
    });
  }

  return todos;
}
