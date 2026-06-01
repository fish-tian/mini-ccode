import type { AgentMessage } from "../agent/types.js";
import type { ModelMessage } from "../llm/types.js";

export function cloneAgentMessage(message: AgentMessage): AgentMessage {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return {
      ...message,
      toolCalls: message.toolCalls.map(call => ({ ...call, input: { ...call.input } }))
    };
  }

  return { ...message };
}

export function toModelMessages(
  messages: readonly AgentMessage[],
  systemPrompt?: string,
  contextMessages: readonly AgentMessage[] = []
): readonly ModelMessage[] {
  const modelMessages: ModelMessage[] = [];

  if (systemPrompt !== undefined) {
    modelMessages.push({ role: "system", content: systemPrompt });
  }

  for (const message of contextMessages) {
    modelMessages.push(toModelMessage(message));
  }

  for (const message of messages) {
    modelMessages.push(toModelMessage(message));
  }

  return modelMessages;
}

function toModelMessage(message: AgentMessage): ModelMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return {
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls
    };
  }

  return { role: message.role, content: message.content };
}
