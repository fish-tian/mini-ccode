import type { AgentEvent } from "../agent/index.js";
import type { TodoList, TodoStatus } from "../todo/index.js";

export type CliOutput = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export function renderAgentEvent(event: AgentEvent, output: CliOutput): void {
  if (event.type === "text_delta") {
    output.writeStdout(event.text);
    return;
  }

  if (event.type === "error") {
    output.writeStderr(`Error: ${event.error.message}\n`);
    return;
  }

  if (event.type === "tool_call") {
    output.writeStdout(`\n[tool] ${event.call.name}\n`);
    return;
  }

  if (event.type === "tool_result") {
    if (event.result.ok) {
      output.writeStdout(`[tool result] ${event.result.content}\n`);
    } else {
      output.writeStderr(`[tool error] ${event.result.error.message}\n`);
    }
    return;
  }

  if (event.type === "sub_agent_event") {
    renderSubAgentEvent(event.description, event.event as AgentEvent, output);
    return;
  }

  if (event.type === "context_compacted") {
    output.writeStdout(
      `\n[context] Automatically compacted context: estimated ${event.result.estimatedTokensBefore} -> ${event.result.estimatedTokensAfter} tokens.\n`
    );
    return;
  }

  if (event.type === "todo_updated") {
    output.writeStdout(renderTodoList(event.todos, event.ownerId));
    return;
  }

  if (event.type === "turn_end" && event.reason === "completed") {
    output.writeStdout("\n");
  }
}

function renderSubAgentEvent(description: string, event: AgentEvent, output: CliOutput): void {
  if (event.type === "tool_call") {
    output.writeStdout(`  [sub-agent tool] ${event.call.name}\n`);
    return;
  }

  if (event.type === "tool_result") {
    const status = event.result.ok ? "result" : "error";
    output.writeStdout(`  [sub-agent tool ${status}] ${event.result.toolName}\n`);
    return;
  }

  if (event.type === "todo_updated") {
    output.writeStdout(indent(renderTodoList(event.todos, event.ownerId)));
    return;
  }

  if (event.type === "error") {
    output.writeStderr(`  [sub-agent error] ${description}: ${event.error.message}\n`);
  }
}

function renderTodoList(todos: TodoList, ownerId = "main"): string {
  const header = ownerId === "main" ? "[todo]" : `[todo: ${ownerIdLabel(ownerId)}]`;
  if (todos.length === 0) {
    return `${header} all tasks completed\n`;
  }

  const statusOrder: readonly TodoStatus[] = ["in_progress", "pending", "completed"];
  const sorted = [...todos].sort((left, right) => {
    const statusDelta =
      statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return left.content.localeCompare(right.content);
  });

  return [
    header,
    ...sorted.map(todo => `  - ${todo.status}: ${todo.content}`)
  ].join("\n") + "\n";
}

function ownerIdLabel(ownerId: string): string {
  if (ownerId.startsWith("subagent:")) {
    return `sub-agent ${ownerId.slice("subagent:".length)}`;
  }
  return ownerId;
}

function indent(text: string): string {
  return text
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => `  ${line}`)
    .join("\n") + "\n";
}

export function renderHelp(output: CliOutput): void {
  output.writeStdout(
    [
      "Commands:",
      "  /help   Show this help",
      "  /compact  Compact conversation context now",
      "  /reset  Clear conversation history",
      "  /save   Save this conversation",
      "  /sessions  List saved conversations",
      "  exit    Exit mini-ccode",
      "  quit    Exit mini-ccode",
      "",
      "Input:",
      "  Type a prompt and press Enter.",
      ""
    ].join("\n")
  );
}
