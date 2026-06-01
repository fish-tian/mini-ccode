import type {
  ModelMessage,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition,
  ProviderError
} from "../llm/index.js";
import { ContextError, type ContextCompactionResult } from "../context/index.js";
import {
  ToolRegistry,
  executeToolCall,
  type Tool,
  type ToolExecutionResult
} from "../tools/index.js";
import {
  createTodoState,
  extractTodosFromMessages,
  todoWriteToolName,
  todoMainOwnerId,
  type TodoList,
  type TodoState
} from "../todo/index.js";
import type {
  AgentError,
  AgentEvent,
  AgentMessage,
  AgentOptions,
  AgentRunOptions,
  AgentStopReason,
  AgentTurnResult
} from "./types.js";

const defaultMaxTurns = 50;

export class Agent {
  readonly #provider: AgentOptions["provider"];
  readonly #tools: ToolRegistry;
  readonly #permissionPolicy: AgentOptions["permissionPolicy"];
  readonly #requestPermission: AgentOptions["requestPermission"];
  readonly #systemPrompt: string | undefined;
  readonly #contextMessages: readonly AgentMessage[];
  readonly #maxTurns: number;
  readonly #contextManager: AgentOptions["contextManager"];
  readonly #todoState: TodoState;
  #messages: AgentMessage[];

  constructor(options: AgentOptions) {
    this.#provider = options.provider;
    this.#tools = options.tools ?? new ToolRegistry();
    this.#permissionPolicy = options.permissionPolicy;
    this.#requestPermission = options.requestPermission;
    this.#systemPrompt = options.systemPrompt;
    this.#contextMessages = [...(options.contextMessages ?? [])];
    this.#maxTurns = options.maxTurns ?? defaultMaxTurns;
    this.#contextManager = options.contextManager;
    this.#messages = [...(options.initialMessages ?? [])];
    this.#todoState =
      options.todoState ?? createTodoState(extractTodosFromMessages(this.#messages));
  }

  getMessages(): readonly AgentMessage[] {
    return this.#messages.map(message => ({ ...message }));
  }

  reset(): void {
    this.#messages = [];
    this.#todoState.reset();
  }

  getTodos(): TodoList {
    return this.#todoState.getTodos();
  }

  async compactContext(
    options: AgentRunOptions = {}
  ): Promise<ContextCompactionResult | undefined> {
    if (this.#contextManager === undefined) {
      return undefined;
    }

    const result = await this.#contextManager.compact(
      this.#messages,
      this.#contextRequest(options)
    );
    if (result !== undefined) {
      this.#messages = [...result.messages];
    }

    return result;
  }

  async run(input: string, options: AgentRunOptions = {}): Promise<AgentTurnResult> {
    let content = "";
    let stopReason: AgentStopReason = "provider_error";

    for await (const event of this.runStream(input, options)) {
      if (event.type === "model_response") {
        content = event.response.content;
      }

      if (event.type === "turn_end") {
        stopReason = event.reason;
      }
    }

    return {
      content,
      stopReason,
      messages: this.getMessages()
    };
  }

  async *runStream(
    input: string,
    options: AgentRunOptions = {}
  ): AsyncIterable<AgentEvent> {
    yield { type: "turn_start", input };

    const userMessage: AgentMessage = { role: "user", content: input };
    this.#messages.push(userMessage);
    yield { type: "message", message: userMessage };

    if (options.signal?.aborted) {
      yield { type: "error", error: abortedAgentError() };
      yield { type: "turn_end", reason: "aborted" };
      return;
    }

    if (this.#maxTurns < 1) {
      yield {
        type: "error",
        error: {
          code: "max_turns",
          message: "Agent reached the maximum number of turns before calling the model."
        }
      };
      yield { type: "turn_end", reason: "max_turns" };
      return;
    }

    let toolTurnCount = 0;

    while (true) {
      const compacted = yield* this.#compactContextIfNeeded(options);
      if (!compacted) {
        return;
      }

      const modelMessages = this.#toModelMessages();
      yield { type: "model_request", messages: modelMessages };

      const response = yield* this.#streamModelResponse(modelMessages, options);
      if (response === undefined) {
        return;
      }

      yield { type: "model_response", response };

      if (!hasToolCalls(response)) {
        const assistantMessage: AgentMessage = {
          role: "assistant",
          content: response.content
        };
        this.#messages.push(assistantMessage);

        yield { type: "message", message: assistantMessage };
        yield { type: "turn_end", reason: "completed" };
        return;
      }

      if (toolTurnCount >= this.#maxTurns) {
        yield {
          type: "error",
          error: {
            code: "max_turns",
            message: "Agent reached the maximum number of tool turns."
          }
        };
        yield { type: "turn_end", reason: "max_turns" };
        return;
      }

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls
      };
      this.#messages.push(assistantMessage);
      yield { type: "message", message: assistantMessage };

      for (const call of response.toolCalls) {
        yield { type: "tool_call", call };

        const runtimeEvents: AgentEvent[] = [];
        const result = await executeToolCall(this.#tools, call, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(this.#permissionPolicy === undefined
            ? {}
            : { permissionPolicy: this.#permissionPolicy }),
          ...(this.#requestPermission === undefined
            ? {}
            : { requestPermission: this.#requestPermission }),
          emitEvent: event => {
            if (event.type === "sub_agent_event") {
              runtimeEvents.push(event);
            }
          }
        });
        for (const event of runtimeEvents) {
          yield event;
        }
        yield { type: "tool_result", result };

        if (result.ok && call.name === todoWriteToolName) {
          const ownerId = todoOwnerIdFromResult(result) ?? todoMainOwnerId;
          yield {
            type: "todo_updated",
            ownerId,
            todos: this.#todoState.getTodos(ownerId)
          };
        }

        const toolMessage = toolMessageFromResult(result);
        this.#messages.push(toolMessage);
        yield { type: "message", message: toolMessage };
      }

      toolTurnCount += 1;
    }
  }

  async *#streamModelResponse(
    modelMessages: readonly ModelMessage[],
    options: AgentRunOptions
  ): AsyncGenerator<AgentEvent, ModelResponse | undefined> {
    const tools = toModelToolDefinitions(this.#tools.list());
    const modelRequest = {
      messages: modelMessages,
      ...(tools.length === 0 ? {} : { tools }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    };

    for await (const event of this.#provider.stream(modelRequest)) {
      if (event.type === "response_start") {
        yield { type: "model_response_start" };
        continue;
      }

      if (event.type === "text_delta") {
        yield { type: "text_delta", text: event.text };
        continue;
      }

      if (event.type === "response_stop") {
        return event.response;
      }

      const error = agentErrorFromProviderError(event.error);
      yield { type: "error", error };
      yield {
        type: "turn_end",
        reason: error.code === "aborted" ? "aborted" : "provider_error"
      };
      return undefined;
    }

    yield {
      type: "error",
      error: {
        code: "provider_error",
        message: "Model stream ended without a final response."
      }
    };
    yield { type: "turn_end", reason: "provider_error" };
    return undefined;
  }

  #toModelMessages(): readonly ModelMessage[] {
    const messages: ModelMessage[] = [];

    if (this.#systemPrompt !== undefined) {
      messages.push({ role: "system", content: this.#systemPrompt });
    }

    for (const message of this.#contextMessages) {
      messages.push(toModelMessage(message));
    }

    for (const message of this.#messages) {
      messages.push(toModelMessage(message));
    }

    return messages;
  }

  #contextRequest(options: AgentRunOptions) {
    const tools = toModelToolDefinitions(this.#tools.list());
    return {
      ...(this.#systemPrompt === undefined ? {} : { systemPrompt: this.#systemPrompt }),
      ...(this.#contextMessages.length === 0
        ? {}
        : { contextMessages: this.#contextMessages }),
      ...(tools.length === 0 ? {} : { tools }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    };
  }

  async *#compactContextIfNeeded(
    options: AgentRunOptions
  ): AsyncGenerator<AgentEvent, boolean> {
    if (this.#contextManager === undefined) {
      return true;
    }

    try {
      const result = await this.#contextManager.compactIfNeeded(
        this.#messages,
        this.#contextRequest(options)
      );
      if (result !== undefined) {
        this.#messages = [...result.messages];
        yield { type: "context_compacted", result };
      }
      return true;
    } catch (error) {
      const agentError = agentErrorFromContextError(error);
      yield { type: "error", error: agentError };
      yield { type: "turn_end", reason: "context_error" };
      return false;
    }
  }
}

function hasToolCalls(
  response: ModelResponse
): response is ModelResponse & { readonly toolCalls: readonly ModelToolCall[] } {
  return (response.toolCalls?.length ?? 0) > 0;
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

function toModelToolDefinitions(tools: readonly Tool[]): readonly ModelToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

function todoOwnerIdFromResult(result: ToolExecutionResult): string | undefined {
  if (!result.ok) {
    return undefined;
  }

  const ownerId = result.metadata?.ownerId;
  return typeof ownerId === "string" ? ownerId : undefined;
}

function toolMessageFromResult(result: ToolExecutionResult): AgentMessage {
  if (result.ok) {
    return {
      role: "tool",
      toolCallId: result.callId,
      toolName: result.toolName,
      content: result.content,
      isError: false
    };
  }

  return {
    role: "tool",
    toolCallId: result.callId,
    toolName: result.toolName,
    content: `Error(${result.error.code}): ${result.error.message}`,
    isError: true
  };
}

function agentErrorFromProviderError(error: ProviderError): AgentError {
  if (error.code === "aborted") {
    return abortedAgentError(error);
  }

  return {
    code: "provider_error",
    message: error.message,
    providerError: error
  };
}

function agentErrorFromContextError(error: unknown): AgentError {
  if (error instanceof ContextError) {
    return {
      code: "context_error",
      message: error.message,
      contextError: error
    };
  }

  return {
    code: "context_error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function abortedAgentError(providerError?: ProviderError): AgentError {
  return {
    code: "aborted",
    message: "Agent run was aborted.",
    ...(providerError === undefined ? {} : { providerError })
  };
}
