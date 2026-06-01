import type { AgentMessage } from "../agent/types.js";
import { cloneAgentMessage } from "./messages.js";
import { segmentMessages } from "./segments.js";

const defaultProtectedRecentSegments = 8;
const toolResultCharacterThreshold = 1500;
const toolResultLineThreshold = 8;
const preservedHeadLines = 4;
const preservedTailLines = 4;
const compactionMarker = "[tool result compacted:";

export type MicrocompactOptions = {
  readonly keepRecentSegments?: number;
};

export type MicrocompactResult = {
  readonly messages: readonly AgentMessage[];
  readonly compactedToolResultCount: number;
};

export function microcompactToolResults(
  messages: readonly AgentMessage[],
  options: MicrocompactOptions = {}
): MicrocompactResult {
  const keepRecentSegments = options.keepRecentSegments ?? defaultProtectedRecentSegments;
  const segments = segmentMessages(messages);
  const protectedStart =
    segments.length > keepRecentSegments
      ? segments[segments.length - keepRecentSegments]?.start ?? messages.length
      : 0;
  let compactedToolResultCount = 0;
  const compacted = messages.map((message, index) => {
    if (index >= protectedStart || message.role !== "tool") {
      return cloneAgentMessage(message);
    }

    const content = compactToolResultContent(message.content);
    if (content === message.content) {
      return cloneAgentMessage(message);
    }

    compactedToolResultCount += 1;
    return { ...message, content };
  });

  return { messages: compacted, compactedToolResultCount };
}

function compactToolResultContent(content: string): string {
  if (content.includes(compactionMarker) || content.length <= toolResultCharacterThreshold) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= toolResultLineThreshold) {
    return content;
  }

  const omittedLineCount = Math.max(0, lines.length - preservedHeadLines - preservedTailLines);
  if (omittedLineCount < 1) {
    return content;
  }

  return [
    ...lines.slice(0, preservedHeadLines),
    `${compactionMarker} omitted ${omittedLineCount} lines, original ${content.length} chars]`,
    ...lines.slice(-preservedTailLines)
  ].join("\n");
}
