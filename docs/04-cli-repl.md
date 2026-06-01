# CLI / REPL 教学文档

## 这个模块解决什么问题

有了 `Agent.runStream()`，项目已经能“在代码里”跑一轮 agent。但这还不是一个能用的工具。

CLI / REPL 解决的是入口问题：

```text
人输入一句话
  -> 程序读到这句话
  -> 交给 Agent
  -> Agent 一边产生事件
  -> CLI 一边把事件打印到终端
```

它不是模型层，也不是工具层。它是人和 agent 之间的外壳。

## 编程 Agent 工具为什么需要它

编程 Agent 工具的核心体验发生在终端里。用户不是写一段测试代码去调用 agent，而是直接输入：

```text
解释一下这个项目
```

或者：

```text
帮我看看测试为什么失败
```

CLI / REPL 要把这种自然输入变成可执行流程。更重要的是，它要让后续模块有地方接入：

```text
输入解析 -> Agent 事件流 -> 输出渲染
```

以后 Tool System、Permission、Session、Context 都会影响这个流程，但第一版先把最小通路打通。

## 最小实现

最小 CLI 只需要两个模式。

one-shot 模式：

```powershell
bun run mini-ccode -- "hello"
```

流程是：

```text
prompt 参数
  -> Agent.runStream(prompt)
  -> text_delta 写到 stdout
  -> 错误写到 stderr
  -> 退出
```

REPL 模式：

```powershell
bun run mini-ccode
```

流程是：

```text
显示提示
  -> 读一行输入
  -> 判断是命令还是 prompt
  -> prompt 交给 Agent
  -> 回到下一轮输入
```

第一版只支持四类内置输入：

- `/help`
- `/reset`
- `exit`
- `quit`

## 本项目中的实现

当前实现新增了 `src/cli/` 和 `bin/mini-ccode.ts`。

整体结构是：

```text
bin/mini-ccode.ts
  -> runCli()
  -> one-shot 或 REPL
  -> Agent.runStream()
  -> renderAgentEvent()
```

`runCli()` 默认从环境变量创建真实 provider，所以手动运行时需要：

```powershell
$env:MINI_CCODE_API_KEY="..."
$env:MINI_CCODE_MODEL="gpt-4o-mini"
bun run mini-ccode -- "hello"
```

如果要走 OpenRouter、LiteLLM proxy 或其他 OpenAI-compatible 网关，可以继续使用之前 LLM Provider 设计里的变量：

```powershell
$env:MINI_CCODE_API_KEY="..."
$env:MINI_CCODE_BASE_URL="https://openrouter.ai/api/v1"
$env:MINI_CCODE_MODEL="anthropic/claude-3.5-sonnet"
bun run mini-ccode -- "hello"
```

测试里不会访问真实 API。测试通过注入 `MockModelProvider` 来固定输出。

## 教学版取舍

ccb 的 CLI / REPL 是完整产品外壳。它包含 Commander 参数系统、React/Ink TUI、`PromptInput`、slash command、输入队列、print mode、stream-json、SDK stdio、权限提示、远程会话和恢复逻辑。

mini-ccode 当前只做最小外壳：

```text
read line
  -> classify input
  -> Agent.runStream()
  -> render text
```

差异可以这样看：

| 层级 | ccb 做法 | mini-ccode 当前实现 |
|---|---|---|
| 表面行为 | 完整交互式 TUI，支持大量命令和模式 | 普通文本 REPL，只支持最小命令 |
| 架构边界 | REPL 协调 QueryEngine、commands、hooks、permissions、session | CLI 只协调 Agent 和终端输入输出 |
| 内部机制 | 输入可排队、可远程、可结构化、可恢复 | 输入一行处理一行 |
| 输出 | UI 组件、text/json/stream-json、SDK 消息 | stdout/stderr 文本 |
| 后续演进 | 已经是完整生产系统 | 后续模块逐步接近 ccb |

这不是省略细节，而是把 ccb 的复杂度拆开学。当前先保证一个原则：CLI 不绕过 Agent Loop。之后每加一个模块，都沿着这条边界接入。

## 关键代码导读

- `bin/mini-ccode.ts`
  - 真正的进程入口。
  - 只负责把 `process.argv/stdin/stdout/stderr` 交给 `runCli()`。

- `src/cli/input.ts`
  - 定义 `CliInput`。
  - 把原始字符串分类成 `empty`、`exit`、`help`、`reset`、`prompt`。

- `src/cli/render.ts`
  - 把 `AgentEvent` 渲染到输出流。
  - 当前只打印 `text_delta` 和 `error`，其他内部事件默认保持安静。

- `src/cli/run.ts`
  - 创建 provider 和 Agent。
  - 决定 one-shot 还是 REPL。
  - REPL 里复用同一个 Agent，所以 history 会留在同一段会话里。

- `tests/cli-*.test.ts`
  - 测输入分类、事件渲染、one-shot、REPL 和缺 API key。

## 常见误区

- CLI 直接调用 provider，绕过 Agent Loop。
- 到处 `console.log`，导致后续很难支持 stream-json 或测试输出。
- 第一版就做完整 slash command，提前依赖还没设计的模块。
- REPL 每一轮都新建 Agent，导致上下文历史丢失。
- 默认测试访问真实 API，导致测试不稳定、变慢、产生费用。
- 缺少 API key 时直接抛堆栈，用户不知道怎么配置。

## 可扩展方向

后续可以逐步增强：

- Tool System 接入后，渲染 tool request / tool result。
- Permission 接入后，在 CLI 中显示确认提示。
- Session 接入后，增加 `/save`、`/resume`。
- Context 接入后，增加 `/compact`。
- Bash 接入后，增加 bash mode 或显式命令。
- 输出协议稳定后，再考虑 `--output-format stream-json`。
- UI 需求明确后，再考虑 React/Ink TUI。

