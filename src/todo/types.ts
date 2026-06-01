export const todoWriteToolName = "TodoWrite";
export const todoMainOwnerId = "main";

export type TodoOwnerId = typeof todoMainOwnerId | `subagent:${string}`;

export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoItem = {
  readonly content: string;
  readonly activeForm: string;
  readonly status: TodoStatus;
};

export type TodoList = readonly TodoItem[];

export type TodoState = {
  readonly getTodos: (ownerId?: string) => TodoList;
  readonly setTodos: (todos: TodoList, ownerId?: string) => void;
  readonly getAllTodos: () => Readonly<Record<string, TodoList>>;
  readonly reset: () => void;
};
