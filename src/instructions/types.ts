import type { AgentMessage } from "../agent/index.js";
import type { Tool } from "../tools/index.js";

export type InstructionPermissionMode = "default" | "read-only" | "allow-all";

export type InstructionOptions = {
  readonly workspaceRoot: string;
  readonly tools: readonly Tool[];
  readonly permissionMode: InstructionPermissionMode;
  readonly now?: Date;
  readonly systemPrompt?: string;
  readonly appendSystemPrompt?: string;
};

export type ProjectInstructions = {
  readonly source: "AGENTS.md";
  readonly path: string;
  readonly content: string;
};

export type InstructionResult = {
  readonly systemPrompt: string;
  readonly contextMessages: readonly AgentMessage[];
  readonly projectInstructions?: ProjectInstructions;
};

