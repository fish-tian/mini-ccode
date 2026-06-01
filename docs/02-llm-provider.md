# LLM Provider 教学文档

## 这个模块解决什么问题

LLM Provider 是 agent 和模型服务之间的边界。

如果没有这个边界，后续 Agent Loop 很容易直接调用 OpenAI、Anthropic 或某个 SDK。这样一来，agent 的测试会依赖真实网络、真实模型输出和 SDK 细节，行为很难固定，也很难写 golden transcript。

本模块把模型调用收敛成两件事：

1. 输入一组 `ModelMessage`。
2. 输出 `ModelResponse` 或一串 `ModelStreamEvent`。

这样后续 agent 只关心“模型说了什么”，不关心底层是 OpenAI、OpenRouter、LiteLLM proxy、本地 Ollama，还是测试里的 mock provider。

## 编程 Agent 工具为什么需要它

编程 Agent 工具不是一次普通 chat completion。它后面会有 agent loop、工具调用、权限判断、上下文管理、session 恢复和 transcript 测试。

模型层如果直接混进这些逻辑，会出现几个问题：

- 真实模型输出不稳定，agent 行为无法复现。
- SDK 类型泄漏到 agent 内部，后续换 provider 会牵动大量代码。
- streaming callback 只适合即时显示，不适合记录完整事件流。
- provider 如果开始执行 tool call，会绕过 Tool System 和 Permission 模块。

所以本项目先定义一个很窄的 provider API。它只负责模型输入输出，不负责工具、不负责权限、不负责上下文裁剪。

## 最小实现

最小可用版本只需要三个东西：

```ts
type ModelMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

interface LanguageModelProvider {
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
```

`complete()` 适合一次性拿最终文本。`stream()` 适合后续 UI、Agent Loop 和 golden transcript，因为它能明确表达：

- response 开始了。
- 文本 delta 到达了。
- response 正常结束了。
- provider 出错了。

## 本项目中的实现

当前实现有两个 provider。

`MockModelProvider` 是测试 provider。它按脚本顺序消费 `MockModelStep`，每次调用固定返回一个 response 或 error。后续 Agent Loop 的单元测试和 golden transcript 会大量依赖它。

`OpenAICompatibleProvider` 是真实 provider。它直接调用 OpenAI-compatible `/chat/completions` streaming endpoint，用 HTTP `fetch` 和 SSE 解析文本增量。

这里的 “OpenAI-compatible” 不是只支持 OpenAI 官方 API。它也能支持兼容 Chat Completions 协议的服务，比如 OpenRouter、DeepSeek、Ollama 或 LiteLLM proxy。Anthropic 模型第一阶段也走这种网关方式，例如通过 OpenRouter 或 LiteLLM proxy 暴露成 OpenAI-compatible 接口。

本阶段没有单独写 `AnthropicProvider`，原因是教学项目先保持一条真实 provider 路径：请求格式、streaming、usage、错误处理都更容易讲清楚，也更容易测试。未来如果需要直连 Anthropic SDK，可以在不改变 Agent Loop 的前提下新增 provider。

## 教学版取舍

ccb 的模型层更像生产系统里的“模型网关”：它不仅要把消息发给模型，还要处理 provider 路由、模型配置、复杂消息块、工具调用相关转换、usage/cost、错误恢复，以及和主循环的协作。

mini-ccode 当前的 LLM Provider 只做一条窄边界：

```text
ModelMessage[]
  -> provider.stream()
  -> ModelStreamEvent[]
```

核心差异如下：

| 维度 | ccb 做法 | mini-ccode 当前实现 |
|---|---|---|
| Provider 组织 | 独立包和更完整的依赖注入边界 | 单包内的 `src/llm/` |
| 厂商支持 | 为多模型、多 provider 演进留了更复杂的位置 | 先用一个 OpenAI-compatible HTTP/SSE provider 覆盖真实调用 |
| 消息结构 | 支持更复杂的消息、工具结果、元数据和上下文形态 | 只支持 `system/user/assistant` 文本消息 |
| Streaming | 面向完整 agent loop 和 UI 的生产事件流 | 面向教学和测试的 `response_start/text_delta/response_stop/error` |
| 工具调用 | 会和工具 schema、tool use、tool result 协作 | 本模块完全不解析工具调用 |
| 测试策略 | 需要覆盖真实生产边界和多层状态 | 默认测试只用 mock；真实 API 走显式 smoke |

这个差异是刻意的。LLM Provider 第一版要让读者先看懂一件事：模型层只是输入输出边界，不是 agent 本身。等 Tool System 和 Context 设计完成后，再扩展消息块、tool call delta、provider registry 或 direct Anthropic provider。

## 关键代码导读

- `src/llm/types.ts`
  - 定义 `LanguageModelProvider`、`ModelMessage`、`ModelResponse`、`ModelStreamEvent` 和 `ProviderError`。
  - `collectModelResponse()` 让 `complete()` 可以复用 `stream()`，避免两套行为。

- `src/llm/mock-provider.ts`
  - 实现确定性的 `MockModelProvider`。
  - 支持固定 response、固定 deltas、固定 error、脚本耗尽错误和 abort。

- `src/llm/openai-compatible-provider.ts`
  - 构造 OpenAI-compatible request body。
  - 解析 SSE `data:` 行。
  - 把 `delta.content` 转成 `text_delta`。
  - 把 usage chunk 收敛成 `ModelUsage`。
  - 把 HTTP、缺 key、非法 stream 转成结构化错误。

- `src/llm/env.ts`
  - 从环境变量创建默认真实 provider。
  - 读取 `MINI_CCODE_API_KEY`、`MINI_CCODE_BASE_URL`、`MINI_CCODE_MODEL`、`MINI_CCODE_MAX_TOKENS`、`MINI_CCODE_TEMPERATURE`。
  - 不读取 `ANTHROPIC_API_KEY`。如果要用 Anthropic 模型，本阶段配置 OpenAI-compatible 网关的 key 和 base URL。

## 常见误区

- 把 agent loop 写成一次 `complete()` 调用。
- 在 provider 里直接执行 tool call。
- streaming 只做 token callback，不产出可断言事件。
- 测试直接访问真实模型。
- 让 SDK 类型扩散到 agent、tool、permission 等模块。
- 为了同时支持多个模型厂商，过早引入复杂 provider registry。
- 把 Anthropic 支持理解成必须直连 Anthropic SDK；网关方式对第一版更简单，也更适合教学。

## 可扩展方向

后续可以在不破坏当前边界的前提下扩展：

- 增加 direct `AnthropicProvider`。
- 增加 provider registry。
- 增加 retry、rate limit 和超时策略。
- 增加 cost tracking。
- 增加 tool call delta 支持。
- 增加 multimodal message content。
- 增加更完整的 model mapping。
- 在 Agent Loop 模块里用 `MockModelProvider` 做 golden transcript 测试。

## 手动 Smoke 测试

真实 provider 连通性通过 `bun run smoke:llm` 手动验证。这个脚本不纳入默认 `bun run test`，避免单元测试误访问真实 API、产生费用或受网络状态影响。

OpenAI 官方 API 示例：

```powershell
$env:MINI_CCODE_API_KEY="..."
$env:MINI_CCODE_MODEL="gpt-4o-mini"
bun run smoke:llm
```

OpenRouter 或 LiteLLM proxy 示例：

```powershell
$env:MINI_CCODE_API_KEY="..."
$env:MINI_CCODE_BASE_URL="https://openrouter.ai/api/v1"
$env:MINI_CCODE_MODEL="anthropic/claude-3.5-sonnet"
bun run smoke:llm
```

也可以设置 `MINI_CCODE_SMOKE_PROMPT` 覆盖默认 smoke prompt。

## 真实集成测试

`bun run test:real:llm` 会运行一个 Vitest 测试，真实调用当前环境变量配置的 OpenAI-compatible provider，并断言返回文本、usage 和 stop reason。

这个测试文件是 `tests/llm-smoke.real.ts`，文件名故意不使用 `.test.ts` 后缀，并且通过 `vitest.real.config.ts` 单独运行，所以默认 `bun run test` 不会执行它。真实测试必须显式运行：

```powershell
$env:MINI_CCODE_API_KEY="..."
$env:MINI_CCODE_BASE_URL="https://aihubmix.com/v1"
$env:MINI_CCODE_MODEL="coding-glm-4.7"
bun run test:real:llm
```
