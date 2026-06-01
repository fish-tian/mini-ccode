import type { Tool } from "./types.js";

export class ToolRegistry {
  readonly #tools: Tool[] = [];
  readonly #names = new Map<string, Tool>();

  constructor(tools: readonly Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    const names = [tool.name, ...(tool.aliases ?? [])];

    for (const name of names) {
      const existing = this.#names.get(name);
      if (existing !== undefined) {
        throw new Error(
          `Tool name conflict for "${name}" between "${existing.name}" and "${tool.name}".`
        );
      }
    }

    this.#tools.push(tool);

    for (const name of names) {
      this.#names.set(name, tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.#names.get(name);
  }

  list(): readonly Tool[] {
    return [...this.#tools];
  }
}
