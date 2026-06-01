# Agent Loop 教学文档

## 这个模块解决什么问题

LLM Provider 只会做一件事：给它一组消息，它返回模型输出。

这还不是 Agent。Agent 至少要记住这次对话里发生过什么，还要让上层知道一次任务什么时候开始、模型什么时候开始输出、文本什么时候到达、什么时候结束、有没有出错。

Agent Loop 就是这层编排。

第一版的 Agent Loop 还不会读文件、跑命令、改代码。它先解决最基本的问题：把一次用户输入变成一条可观察、可测试的事件流。

## 编程 Agent 工具为什么需要它

用户说“帮我修测试”时，真正的 coding agent 不是立刻猜答案。它应该一步步推进：

```text
看测试错误 -> 找相关代码 -> 修改 -> 再验证 -> 总结
```

这里每一步都要写进历史，因为下一步模型要看到前面发生了什么。普通 `chat completion` 没有这个“连续做事”的外壳，它只是一次请求和一次回答。

编程 Agent 的核心就是这个循环。更完整的系统通常会把它描述成“思考 -> 行动 -> 观察”的状态机；本项目第一版先做 text-only 事件流，不提前塞工具。

## 最小实现

最小 Agent Loop 可以先不做工具：

```text
用户输入
  -> 保存 user message
  -> 组装 model messages
  -> 调 provider.stream()
  -> 转发 text_delta
  -> 保存 assistant message
  -> turn_end(completed)
```

这已经和直接调用 provider 不一样了。Provider 是无状态的；Agent 拥有 history。

## 本项目中的实现

当前实现新增了 `src/agent/`。

`Agent` 构造时接收一个 `LanguageModelProvider`。这意味着 Agent 不知道底层是真实 OpenAI-compatible provider，还是测试里的 `MockModelProvider`。

主要接口有两个：

- `runStream(input)`：主接口，返回 `AsyncIterable<AgentEvent>`。
- `run(input)`：便利接口，消费 `runStream()` 后返回最终结果。

正常事件流长这样：

```text
turn_start
message(user)
model_request
model_response_start
text_delta*
model_response
message(assistant)
turn_end(completed)
```

错误也走事件流，而不是散落成异常：

```text
error(provider_error)
turn_end(provider_error)
```

这样后续 CLI / REPL 可以直接按事件渲染，测试也可以断言完整 transcript。

## 教学版取舍

生产级系统 的 Agent Loop 是完整生产形态：模型可以请求工具，工具结果会写回消息历史，循环继续；中间还要处理权限、上下文压缩、abort、恢复、并发工具执行和 UI 渲染。

mini-ccode 当前实现只保留最小骨架：

```text
user input
  -> history
  -> provider.stream()
  -> AgentEvent
  -> assistant history
```

差异可以分成三层看：

| 层级 | 完整产品级做法 | mini-ccode 当前实现 |
|---|---|---|
| 表面行为 | 能连续使用工具完成任务 | 只能完成一轮文本回复 |
| 架构边界 | Loop 会协调工具、权限、上下文、恢复 | Loop 只协调 provider 和 history |
| 内部机制 | 工具调用可以作为下一轮模型输入继续循环 | 收到 `response_stop` 后就结束这一轮 |

这不是说工具不重要。恰恰相反，工具太重要，所以不能在 Agent Loop 里随手硬编码。当前实现先把“事件流”和“消息历史”做好，后面 Tool System、Permission、File Tools、Bash 都会沿着这条流接进来。

接近 生产级系统 的路线会是：

```text
text-only loop
  -> tool request / tool result
  -> permission gate
  -> context management
  -> session resume
  -> streaming tool execution
```

## 关键代码导读

- `src/agent/types.ts`
  - 定义 `AgentMessage`、`AgentEvent`、`AgentTurnResult`、`AgentError`。
  - 第一版只支持 `user` 和 `assistant`，没有 `tool`。

- `src/agent/agent.ts`
  - 实现 `Agent`。
  - 保存 history。
  - 把 `systemPrompt + history` 转成 `ModelMessage[]`。
  - 消费 provider stream，并转换成 Agent events。

- `tests/agent-loop.test.ts`
  - 覆盖 history、system prompt、reset、provider error、abort、max turns、空 stream。

- `tests/agent-loop-golden.test.ts`
  - 固定 mock provider 输出，断言完整事件序列。
  - 这是后续工具调用 golden transcript 的起点。

## 常见误区

- 把 agent loop 写成一次 `provider.complete()`。
- 让 provider 保存 conversation。
- 只返回最终字符串，不暴露中间事件。
- 一开始就加 tool role，但没有完整 Tool System 和 Permission。
- provider error 直接抛出，导致 CLI 和 transcript 不稳定。
- 不做 max turns，后续工具循环容易无限跑。
- system prompt 混进用户历史，导致 session 和 context 后续难处理。

## 为什么现在不做工具

工具调用当然是 Agent Loop 的关键部分，但它牵涉四个模块：

- Tool System：工具怎么注册、schema 怎么表达。
- Permission：危险工具怎么授权。
- File Tools：读写文件怎么保证边界。
- Bash：命令怎么分类和执行。

如果现在在 Agent Loop 里临时塞一个工具执行逻辑，后面很容易返工。当前实现只铺好事件流和消息历史。等 Tool System 设计通过后，再把这个继续条件接进来：

```text
model_response(tool_request)
  -> tool_result
  -> 再次 model_request
```

## 可扩展方向

下一步 CLI / REPL 可以直接消费 `Agent.runStream()`，让项目先能启动和手动体验。

后续模块可以逐步接入：

- Tool System：增加 tool request / tool result 事件。
- Permission：工具执行前检查授权。
- Context：在 model_request 前裁剪或压缩 history。
- Session：把 Agent history 持久化。
- Bash / File Tools：把真实 coding 行动接进 loop。
- Golden Transcript：覆盖多轮工具调用、权限拒绝、工具失败和 abort。
