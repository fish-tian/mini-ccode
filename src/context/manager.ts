import type { AgentMessage } from "../agent/types.js";
import { estimateContextTokens } from "./estimate.js";
import { toModelMessages } from "./messages.js";
import { microcompactToolResults } from "./microcompact.js";
import { segmentCutoff, segmentMessages } from "./segments.js";
import {
  ContextError,
  type ContextCompactionResult,
  type ContextManager,
  type ContextManagerOptions,
  type ContextRequestContext
} from "./types.js";

const defaultMaxEstimatedTokens = 128_000;
const defaultAutoCompactRatio = 0.7;
const defaultKeepRecentSegments = 8;

export function createContextManager(options: ContextManagerOptions): ContextManager {
  const maxEstimatedTokens = options.maxEstimatedTokens ?? defaultMaxEstimatedTokens;
  const autoCompactRatio = options.autoCompactRatio ?? defaultAutoCompactRatio;
  const keepRecentSegments = options.keepRecentSegments ?? defaultKeepRecentSegments;
  const threshold = Math.floor(maxEstimatedTokens * autoCompactRatio);

  return {
    async compact(messages, request) {
      return compactMessages({
        messages,
        request,
        trigger: "manual",
        threshold,
        keepRecentSegments,
        summarizer: options.summarizer,
        forceSummary: true
      });
    },

    async compactIfNeeded(messages, request) {
      const estimatedTokensBefore = estimateMessages(messages, request);
      if (estimatedTokensBefore < threshold) {
        return undefined;
      }

      return compactMessages({
        messages,
        request,
        trigger: "automatic",
        threshold,
        keepRecentSegments,
        summarizer: options.summarizer,
        forceSummary: false,
        estimatedTokensBefore
      });
    }
  };
}

async function compactMessages(options: {
  readonly messages: readonly AgentMessage[];
  readonly request: ContextRequestContext;
  readonly trigger: "manual" | "automatic";
  readonly threshold: number;
  readonly keepRecentSegments: number;
  readonly summarizer: ContextManagerOptions["summarizer"];
  readonly forceSummary: boolean;
  readonly estimatedTokensBefore?: number;
}): Promise<ContextCompactionResult | undefined> {
  const estimatedTokensBefore =
    options.estimatedTokensBefore ?? estimateMessages(options.messages, options.request);
  const microcompactResult = microcompactToolResults(options.messages, {
    keepRecentSegments: options.keepRecentSegments
  });
  let messages = microcompactResult.messages;
  let compactedSegmentCount = 0;

  const estimatedTokensAfterMicrocompact = estimateMessages(messages, options.request);
  const shouldSummarize =
    options.forceSummary || estimatedTokensAfterMicrocompact >= options.threshold;

  if (shouldSummarize) {
    const cutoff = segmentCutoff(messages, options.keepRecentSegments);
    if (cutoff === undefined) {
      if (microcompactResult.compactedToolResultCount > 0) {
        return resultFor({
          trigger: options.trigger,
          messages,
          estimatedTokensBefore,
          estimatedTokensAfter: estimatedTokensAfterMicrocompact,
          compactedToolResultCount: microcompactResult.compactedToolResultCount,
          compactedSegmentCount
        });
      }

      if (options.trigger === "automatic") {
        throw new ContextError(
          "no_safe_compaction",
          "Context is over the configured limit, but there are no old message segments that can be safely compacted."
        );
      }

      return undefined;
    }

    const oldMessages = messages.slice(0, cutoff);
    const recentMessages = messages.slice(cutoff);
    let summary: string;
    try {
      summary = await options.summarizer.summarize({
        messages: oldMessages,
        ...(options.request.contextMessages === undefined
          ? {}
          : { contextMessages: options.request.contextMessages }),
        trigger: options.trigger,
        ...(options.request.signal === undefined ? {} : { signal: options.request.signal })
      });
    } catch (error) {
      throw new ContextError(
        "summary_failed",
        `Unable to compact context summary. ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (summary.trim().length === 0) {
      throw new ContextError("empty_summary", "Unable to compact context because the summary was empty.");
    }

    compactedSegmentCount = segmentMessages(oldMessages).length;
    messages = [
      {
        role: "user",
        content: `[Earlier conversation summary]\n${summary.trim()}`
      },
      {
        role: "assistant",
        content: "I have the earlier context and will continue the task from it."
      },
      ...recentMessages
    ];
  }

  const estimatedTokensAfter = estimateMessages(messages, options.request);
  if (
    microcompactResult.compactedToolResultCount === 0 &&
    compactedSegmentCount === 0
  ) {
    return undefined;
  }

  return resultFor({
    trigger: options.trigger,
    messages,
    estimatedTokensBefore,
    estimatedTokensAfter,
    compactedToolResultCount: microcompactResult.compactedToolResultCount,
    compactedSegmentCount
  });
}

function estimateMessages(
  messages: readonly AgentMessage[],
  request: ContextRequestContext
): number {
  return estimateContextTokens({
    messages: toModelMessages(
      messages,
      request.systemPrompt,
      request.contextMessages ?? []
    ),
    tools: request.tools ?? []
  });
}

function resultFor(result: ContextCompactionResult): ContextCompactionResult {
  return result;
}
