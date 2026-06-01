import type { AgentEvent } from "../agent/index.js";
import type { ContextManager } from "../context/index.js";
import type { LanguageModelProvider } from "../llm/index.js";
import type { PermissionPolicy, PermissionPrompt } from "../permission/index.js";
import type { Tool } from "../tools/index.js";
import type { TodoState } from "../todo/index.js";

export type SubAgentType = "general" | "explore";

export type SubAgentToolOptions = {
  readonly provider: LanguageModelProvider;
  readonly workspaceRoot?: string;
  readonly parentTools: readonly Tool[];
  readonly permissionPolicy?: PermissionPolicy;
  readonly requestPermission?: PermissionPrompt;
  readonly maxTurns?: number;
  readonly maxResultChars?: number;
  readonly createContextManager?: () => ContextManager;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly todoState?: TodoState;
};

export type SubAgentInput = {
  readonly description: string;
  readonly prompt: string;
  readonly subagentType: SubAgentType;
};

export type SubAgentRunResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly message: string };
