import type { AgentMessage } from "../agent/types.js";
import { ContextError } from "./types.js";

export type MessageSegment = {
  readonly start: number;
  readonly end: number;
};

export function segmentMessages(messages: readonly AgentMessage[]): readonly MessageSegment[] {
  const segments: MessageSegment[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (message === undefined) {
      break;
    }

    if (message.role === "tool") {
      throw new ContextError(
        "invalid_message_sequence",
        "Cannot compact context because a tool result appears without its assistant tool call."
      );
    }

    if (message.role !== "assistant" || message.toolCalls === undefined) {
      segments.push({ start: index, end: index + 1 });
      index += 1;
      continue;
    }

    const expectedToolCallIds = new Set(message.toolCalls.map(call => call.id));
    let end = index + 1;

    while (end < messages.length) {
      const candidate = messages[end];
      if (candidate?.role !== "tool" || !expectedToolCallIds.has(candidate.toolCallId)) {
        break;
      }

      end += 1;
    }

    segments.push({ start: index, end });
    index = end;
  }

  return segments;
}

export function segmentCutoff(
  messages: readonly AgentMessage[],
  keepRecentSegments: number
): number | undefined {
  const segments = segmentMessages(messages);
  if (segments.length <= keepRecentSegments) {
    return undefined;
  }

  return segments[Math.max(0, segments.length - keepRecentSegments)]?.start;
}
