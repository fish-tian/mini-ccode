import { collectModelResponse, type LanguageModelProvider } from "../llm/index.js";
import type { ContextSummarizer, ContextSummaryRequest } from "./types.js";

export function createProviderContextSummarizer(
  provider: LanguageModelProvider
): ContextSummarizer {
  return {
    async summarize(request: ContextSummaryRequest): Promise<string> {
      const response = await collectModelResponse(
        provider.stream({
          messages: [
            {
              role: "system",
              content: [
                "You summarize earlier development conversation for continuation.",
                "Preserve user goals, explicit constraints, changed files, decisions, errors, unresolved work, and next steps.",
                "Do not invent completed work. Do not call tools. Return only the summary."
              ].join(" ")
            },
            {
              role: "user",
              content: flattenMessagesForSummary([
                ...(request.contextMessages ?? []),
                ...request.messages
              ])
            }
          ],
          ...(request.signal === undefined ? {} : { signal: request.signal })
        })
      );

      return response.content.trim();
    }
  };
}

function flattenMessagesForSummary(messages: readonly ContextSummaryRequest["messages"][number][]): string {
  return messages
    .map(message => {
      if (message.role === "tool") {
        return `[tool:${message.toolName}${message.isError ? ":error" : ""}] ${message.content}`;
      }

      if (message.role === "assistant" && message.toolCalls !== undefined) {
        const toolNames = message.toolCalls.map(call => call.name).join(", ");
        return `[assistant tool calls: ${toolNames}] ${message.content}`;
      }

      return `[${message.role}] ${message.content}`;
    })
    .join("\n\n");
}
