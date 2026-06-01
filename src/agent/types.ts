import type {
  LanguageModelProvider,
  ModelToolCall,
  ModelMessage,
  ModelResponse,
  ProviderError
} from "../llm/index.js";
import type {
  ContextCompactionResult,
  ContextError,
  ContextManager
} from "../context/index.js";
import type { PermissionPolicy, PermissionPrompt } from "../permission/index.js";
import type { ToolExecutionResult, ToolRegistry, ToolRuntimeEvent } from "../tools/index.js";
import type { TodoList, TodoState } from "../todo/index.js";

export type AgentRole = "user" | "assistant" | "tool";

export type AgentUserMessage = {
  readonly role: "user";
  readonly content: string;
};

export type AgentAssistantMessage = {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls?: readonly ModelToolCall[];
};

export type AgentToolMessage = {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
};

export type AgentMessage =
  | AgentUserMessage
  | AgentAssistantMessage
  | AgentToolMessage;

export type AgentStopReason =
  | "completed"
  | "provider_error"
  | "aborted"
  | "max_turns"
  | "context_error";

export type AgentError = {
  readonly code: "provider_error" | "aborted" | "max_turns" | "context_error";
  readonly message: string;
  readonly providerError?: ProviderError;
  readonly contextError?: ContextError;
};

export type AgentEvent =
  | { readonly type: "turn_start"; readonly input: string }
  | { readonly type: "message"; readonly message: AgentMessage }
  | { readonly type: "model_request"; readonly messages: readonly ModelMessage[] }
  | { readonly type: "model_response_start" }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "model_response"; readonly response: ModelResponse }
  | { readonly type: "context_compacted"; readonly result: ContextCompactionResult }
  | { readonly type: "tool_call"; readonly call: ModelToolCall }
  | ToolRuntimeEvent
  | { readonly type: "tool_result"; readonly result: ToolExecutionResult }
  | { readonly type: "todo_updated"; readonly ownerId: string; readonly todos: TodoList }
  | { readonly type: "turn_end"; readonly reason: AgentStopReason }
  | { readonly type: "error"; readonly error: AgentError };

export type AgentTurnResult = {
  readonly content: string;
  readonly stopReason: AgentStopReason;
  readonly messages: readonly AgentMessage[];
};

export type AgentOptions = {
  readonly provider: LanguageModelProvider;
  readonly tools?: ToolRegistry;
  readonly permissionPolicy?: PermissionPolicy;
  readonly requestPermission?: PermissionPrompt;
  readonly systemPrompt?: string;
  readonly contextMessages?: readonly AgentMessage[];
  readonly initialMessages?: readonly AgentMessage[];
  readonly maxTurns?: number;
  readonly contextManager?: ContextManager;
  readonly todoState?: TodoState;
};

export type AgentRunOptions = {
  readonly signal?: AbortSignal;
};
