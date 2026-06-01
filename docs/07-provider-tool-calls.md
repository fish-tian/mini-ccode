# 第 07 章：Provider Tool Calls（模型工具调用协议）

## 本章目标

读完本章，你应该能理解：

- 模型工具调用和用户手动命令的区别。
- provider 如何把工具调用流式传给 Agent。
- Agent Loop 如何把工具结果再交回模型。

## 这个模块解决什么问题

Provider Tool Calls 解决的是“真实模型怎么把工具调用交给 Agent Loop”的问题。

在前面的阶段里，Agent Loop 已经能消费测试模型返回的 `toolCalls`，Tool System 也已经能执行工具。但真实 OpenAI-compatible provider 还只能处理普通文本：请求时不会把工具定义发给模型，响应时也不会解析模型流式返回的工具调用。

本阶段补上这条接线：

```text
ToolRegistry
  -> ModelRequest.tools
  -> OpenAI-compatible tools 字段
  -> delta.tool_calls
  -> ModelResponse.toolCalls
  -> Agent Loop 执行工具
```

这样后续 File Tools 接入后，模型才能通过自然语言请求选择 `read_file`、`grep`、`glob` 等真实工具。

## 编程 Agent 工具为什么需要它

编程 Agent 工具里的“工具调用”不是用户手动输入 `/tool read_file ...`。真实流程是：

```text
用户：帮我看 package.json
模型：我需要调用 read_file
Agent：执行 read_file
模型：根据文件内容继续回答
```

这要求 provider 层能做两件事：

1. 把本地可用工具的名称、说明和输入结构发给模型。
2. 把模型返回的工具调用解析成 Agent Loop 能理解的结构。

如果 provider 不做这件事，Tool System 和 Permission 即使已经存在，也只能在测试里被触发，真实模型无法使用。

## 最小实现

最小实现需要三个结构。

第一，模型请求携带工具定义：

```ts
type ModelRequest = {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
};
```

第二，消息历史保留结构化工具消息，而不是压成普通文本：

```ts
assistant tool_calls
tool role result
```

第三，OpenAI-compatible provider 解析流式工具调用增量：

```text
delta.tool_calls[index].function.arguments
```

工具参数会被分成多段返回，所以实现中按 `index` 累积，最后再解析 JSON。

## 本项目中的实现

本阶段改了三个主要位置。

`src/llm/types.ts` 增加了：

- `ModelToolDefinition`
- 支持 `toolCalls` 的 assistant message
- 支持 `role: "tool"` 的 tool result message
- `invalid_tool_arguments` provider error

`src/llm/openai-compatible-provider.ts` 现在会：

- 把 `ModelRequest.tools` 转成 OpenAI-compatible `tools`
- 把 assistant `toolCalls` 转成 `assistant.tool_calls`
- 把 tool result 转成 `role: "tool"`
- 累积并解析 `delta.tool_calls`
- 参数 JSON 损坏时返回 `invalid_tool_arguments`

`src/agent/agent.ts` 现在会：

- 从 `ToolRegistry.list()` 生成 provider 工具定义
- 请求模型时传入 `tools`
- 把 assistant tool calls 和 tool result 保留为结构化 `ModelMessage`

## 阶段性体现

本阶段不是 File Tools 的端到端完成。它的体现是：

```text
provider 请求体能看到 tools
provider 响应能解析 tool_calls
Agent Loop 后续请求能保留 assistant tool_calls 和 tool role result
CLI 已有工具事件渲染能力
```

也就是说，本阶段完成的是“真实模型工具调用协议接线”。真实文件工具还没有实现，下一阶段需要接入 File Tools。

## 教学版取舍

| 维度 | ccb 做法 | mini-ccode 当前阶段 |
|---|---|---|
| 工具消息格式 | Anthropic 风格 `tool_use` / `tool_result` block 为主，并有复杂归一化 | OpenAI-compatible `tool_calls` / `tool` role |
| 工具执行时机 | 支持更复杂的流式工具执行器 | 等 provider response 结束后执行 |
| 工具结果处理 | 有结果存储、截断和上下文压缩 | 直接把工具结果放回消息历史 |
| 工具池 | 内置大量工具和动态工具能力 | 先支持 ToolRegistry 中的本地工具 |
| 权限交互 | 有更完整的权限 UI 和策略 | 当前只接入 PermissionPolicy 执行链路 |

mini-ccode 的取舍是先把协议闭环讲清楚：工具定义如何发给模型，工具调用如何解析，工具结果如何回到下一轮请求。

## 关键代码导读

| 文件 | 重点 |
|---|---|
| `src/llm/types.ts` | 模型工具定义、结构化工具消息、provider 错误类型 |
| `src/llm/openai-compatible-provider.ts` | OpenAI-compatible 请求转换和 `delta.tool_calls` 解析 |
| `src/agent/agent.ts` | 从 ToolRegistry 传工具 schema，保留结构化工具消息 |
| `tests/openai-compatible-provider.test.ts` | provider 请求和流式工具调用解析测试 |
| `tests/agent-loop.test.ts` | Agent Loop 工具 schema 传递和结构化后续请求测试 |
| `tests/agent-loop-golden.test.ts` | 工具调用黄金转录 |

## 常见误区

- 把工具调用写成用户手动命令。真实路径应该是模型自己发 tool call。
- 把 tool result 压成普通 user 文本。这样 provider 无法形成标准工具调用消息历史。
- 静默吞掉损坏的工具参数 JSON。这样会把 provider 输出格式错误伪装成工具输入错误。
- 只改类型，不加测试观察 provider 请求和 Agent 后续请求。本项目要求每一步都有阶段性体现。

## 可扩展方向

下一步是 File Tools：

```text
read_file / glob / grep / write_file / edit_file
  -> Tool System
  -> Permission
  -> Agent Loop
  -> provider tool calls
```

再往后可以补：

- CLI 权限审批交互
- Bash 工具
- 工具结果压缩和上下文管理
- Anthropic 原生消息块
- 动态工具池和插件工具
