export type CliInput =
  | { readonly type: "empty" }
  | { readonly type: "exit" }
  | { readonly type: "help" }
  | { readonly type: "compact" }
  | { readonly type: "reset" }
  | { readonly type: "save" }
  | { readonly type: "sessions" }
  | { readonly type: "prompt"; readonly text: string };

export function parseCliInput(input: string): CliInput {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { type: "empty" };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "exit" || lower === "quit" || lower === "/exit" || lower === "/quit") {
    return { type: "exit" };
  }

  if (lower === "/help") {
    return { type: "help" };
  }

  if (lower === "/compact") {
    return { type: "compact" };
  }

  if (lower === "/reset") {
    return { type: "reset" };
  }

  if (lower === "/save") {
    return { type: "save" };
  }

  if (lower === "/sessions") {
    return { type: "sessions" };
  }

  return { type: "prompt", text: trimmed };
}
