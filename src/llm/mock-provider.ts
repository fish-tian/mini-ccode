import {
  abortedProviderError,
  collectModelResponse,
  type LanguageModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelStopReason,
  type ModelStreamEvent,
  type ModelToolCall,
  type ModelUsage,
  type ProviderError
} from "./types.js";

export type MockModelResponseStep = {
  readonly type: "response";
  readonly content: string;
  readonly usage?: Partial<ModelUsage>;
  readonly stopReason?: ModelStopReason;
  readonly model?: string;
  readonly deltas?: readonly string[];
  readonly toolCalls?: readonly ModelToolCall[];
};

export type MockModelErrorStep = {
  readonly type: "error";
  readonly error: ProviderError;
};

export type MockModelStep = MockModelResponseStep | MockModelErrorStep;

export class MockModelProvider implements LanguageModelProvider {
  readonly #steps: MockModelStep[];
  #nextStepIndex = 0;

  constructor(steps: readonly MockModelStep[]) {
    this.#steps = [...steps];
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return collectModelResponse(this.stream(request));
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();

    if (request.signal?.aborted) {
      yield { type: "error", error: abortedProviderError() };
      return;
    }

    const step = this.#steps[this.#nextStepIndex];
    this.#nextStepIndex += 1;

    if (step === undefined) {
      yield {
        type: "error",
        error: {
          code: "script_exhausted",
          message: "Mock model provider has no remaining scripted steps."
        }
      };
      return;
    }

    yield { type: "response_start" };

    if (step.type === "error") {
      yield { type: "error", error: step.error };
      return;
    }

    for (const text of deltasForStep(step)) {
      if (request.signal?.aborted) {
        yield { type: "error", error: abortedProviderError() };
        return;
      }

      if (text.length > 0) {
        yield { type: "text_delta", text };
      }
    }

    yield {
      type: "response_stop",
      response: responseForStep(step)
    };
  }
}

function deltasForStep(step: MockModelResponseStep): readonly string[] {
  if (step.deltas !== undefined) {
    return step.deltas;
  }

  return step.content.length > 0 ? [step.content] : [];
}

function responseForStep(step: MockModelResponseStep): ModelResponse {
  return {
    content: step.content,
    stopReason: step.stopReason ?? "end_turn",
    usage: {
      inputTokens: step.usage?.inputTokens ?? 0,
      outputTokens: step.usage?.outputTokens ?? 0
    },
    ...(step.model === undefined ? {} : { model: step.model }),
    ...(step.toolCalls === undefined ? {} : { toolCalls: step.toolCalls })
  };
}
