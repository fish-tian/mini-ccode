import type { AgentMessage } from "../agent/types.js";
import type {
  LanguageModelProvider,
  ModelMessage,
  ModelToolDefinition
} from "../llm/types.js";

export type ContextCompactionTrigger = "manual" | "automatic";

export type ContextRequestContext = {
  readonly systemPrompt?: string;
  readonly contextMessages?: readonly AgentMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly signal?: AbortSignal;
};

export type ContextSummaryRequest = {
  readonly messages: readonly AgentMessage[];
  readonly contextMessages?: readonly AgentMessage[];
  readonly trigger: ContextCompactionTrigger;
  readonly signal?: AbortSignal;
};

export interface ContextSummarizer {
  summarize(request: ContextSummaryRequest): Promise<string>;
}

export type ContextManagerOptions = {
  readonly summarizer: ContextSummarizer;
  readonly maxEstimatedTokens?: number;
  readonly autoCompactRatio?: number;
  readonly keepRecentSegments?: number;
};

export type ContextCompactionResult = {
  readonly trigger: ContextCompactionTrigger;
  readonly messages: readonly AgentMessage[];
  readonly estimatedTokensBefore: number;
  readonly estimatedTokensAfter: number;
  readonly compactedToolResultCount: number;
  readonly compactedSegmentCount: number;
};

export interface ContextManager {
  compact(
    messages: readonly AgentMessage[],
    request: ContextRequestContext
  ): Promise<ContextCompactionResult | undefined>;

  compactIfNeeded(
    messages: readonly AgentMessage[],
    request: ContextRequestContext
  ): Promise<ContextCompactionResult | undefined>;
}

export type ContextErrorCode =
  | "invalid_message_sequence"
  | "summary_failed"
  | "empty_summary"
  | "no_safe_compaction";

export class ContextError extends Error {
  readonly code: ContextErrorCode;

  constructor(code: ContextErrorCode, message: string) {
    super(message);
    this.name = "ContextError";
    this.code = code;
  }
}

export type ProviderContextSummarizerOptions = {
  readonly provider: LanguageModelProvider;
};

export type ContextEstimateInput = {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
};
