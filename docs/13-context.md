# 第 13 章：Context（上下文整理）

## 本章目标

读完本章，你应该能理解：

- 为什么 Agent 不能把历史无限追加到模型请求里。
- 局部压缩和摘要压缩分别解决什么问题。
- mini-ccode 当前 Context 机制与 ccb 的差距。

## 1. 这个模块交付了什么

mini-ccode 现在有了一个可观察的上下文整理路径：

1. REPL 中输入 `/compact`，用户可以手动把较早历史整理成摘要。
2. CLI 启动时可以使用 `--context-limit <tokens>` 调整估算上限。
3. Agent 在每次请求模型前会检查上下文长度，达到阈值时自动整理。
4. 自动整理发生时，CLI 会显示 `[context] Automatically compacted context...`。

这不是隐藏在内部的库 API。默认 CLI Agent 已经创建并使用 `ContextManager`，所以用户路径、Agent 事件和集成测试都能观察到它。

## 2. 最小模型

上下文整理解决的是一个简单问题：对话历史会不断增长，工具结果尤其容易变长。如果每次都把全部内容发给模型，最终会超过模型上下文窗口。

mini-ccode 第一版把整理分成两层：

| 层 | 中文解释 | 是否调用模型 |
|---|---|---|
| 局部压缩（MicroCompact） | 先把较旧、较长的工具结果正文变短，只保留开头、结尾和省略说明 | 否 |
| 摘要压缩（summary compact） | 再把较早的完整消息段交给模型总结成继续工作需要的摘要 | 是 |

自动整理时，mini-ccode 先估算即将发送给模型的请求长度。默认上限是 `128000`，达到 `70%` 时触发自动整理。这个估算不是精确分词器，而是稳定的字符估算，适合教学版和确定性测试。

## 3. 消息段为什么重要

工具调用不能随便切开。下面这两条必须成对保留：

```text
assistant(toolCalls: [call_1])
tool(toolCallId: call_1)
```

如果只保留 `tool` 结果、不保留前面的 assistant 工具请求，模型提供层会收到非法序列。因此 Context Manager 会先把历史切成“消息段”：

| 消息 | 段规则 |
|---|---|
| 普通 `user` | 单独一段 |
| 普通 `assistant` | 单独一段 |
| 带 `toolCalls` 的 `assistant` | 和后面匹配的 `tool` 结果组成一段 |
| 孤立 `tool` | 视为内部协议错误 |

整理只发生在消息段边界，不拆开工具调用和工具结果组合。

## 4. 局部压缩如何工作

局部压缩只处理旧的 `tool` 消息正文。默认保留最近 `8` 个消息段不动，保护用户和模型刚刚使用过的信息。

处理顺序是从旧到新。越早的工具结果越先被压缩，符合“时间越久越容易清理”的直觉。

当旧工具结果超过 `1500` 个字符并且超过 `8` 行时，mini-ccode 保留前 `4` 行和后 `4` 行，中间插入说明：

```text
[tool result compacted: omitted 124 lines, original 9230 chars]
```

这不是 ccb 完整的 MicroCompact。ccb 可以结合缓存和完整会话记录删除旧工具结果正文；mini-ccode 第一版没有完整原始记录，所以不能把正文完全清空，只做首尾保留式压缩。

## 5. 摘要压缩如何工作

如果手动执行 `/compact`，或者自动局部压缩后仍然超过阈值，mini-ccode 会把较早消息段发给同一个模型提供层生成摘要。

整理成功后，较早历史会替换成两条消息：

```text
user: [Earlier conversation summary]
      <summary>
assistant: I have the earlier context and will continue the task from it.
```

最近消息段原样保留。这样后续模型请求仍然能看到任务摘要和近期细节。

摘要失败时，mini-ccode 不会覆盖原历史。自动整理失败会让当前轮次以 `context_error` 停止；手动 `/compact` 会在 CLI 中显示错误。

## 6. 用户可见入口

手动整理：

```text
/compact
```

有内容可整理时：

```text
[context] Compacted context: estimated 1840 -> 610 tokens.
```

没有足够旧的消息段可整理时：

```text
[context] Nothing to compact yet.
```

调整估算上限：

```powershell
bun run mini-ccode -- --context-limit 2000
```

如果长对话触发自动整理，CLI 会输出：

```text
[context] Automatically compacted context: estimated 92000 -> 12600 tokens.
```

## 7. 代码结构

| 文件 | 职责 |
|---|---|
| `src/context/types.ts` | Context 的公共类型、结果和错误 |
| `src/context/estimate.ts` | 稳定的容量估算 |
| `src/context/segments.ts` | 协议安全的消息段划分 |
| `src/context/microcompact.ts` | 旧工具结果的局部压缩 |
| `src/context/summarizer.ts` | 使用模型提供层生成摘要 |
| `src/context/manager.ts` | 编排手动整理和自动整理 |
| `src/agent/agent.ts` | 在模型请求前调用 Context Manager |
| `src/cli/run.ts` | 创建默认 Context Manager，处理 `/compact` |

## 8. 教学版取舍

| 层次 | ccb 做法 | mini-ccode 当前实现 | 后续需要什么 |
|---|---|---|---|
| 用户入口 | 支持手动和自动压缩 | 支持 `/compact` 和自动整理提示 | 后续可增加更多压缩参数 |
| 局部压缩 | 更完整的 MicroCompact，结合缓存和原始记录 | 只压缩旧工具结果正文，保留首尾 | 需要完整会话记录和缓存层 |
| 会话记忆压缩 | 支持会话记忆压缩 | 未实现 | 需要先设计长期项目记忆边界 |
| 压缩边界 | 记录更丰富的边界和附件状态 | 只在消息段边界切分 | 需要新的持久化结构 |
| 附件重新注入 | 可重新注入文件、技能、任务状态等 | 未实现 | 需要完整会话记录、Skills、Todo 等后续状态来源 |
| 上下文窗口 | 可结合更真实的容量信息 | 使用可配置字符估算 | 后续可按 provider 设计模型窗口配置 |

mini-ccode 当前版本的目标是把最小可用链路做通：用户能触发、Agent 能自动调用、CLI 能看见、测试能证明不会拆坏工具协议。它不假装已经具备 ccb 的完整上下文工程。

## 9. 测试覆盖

当前测试证明：

1. 容量估算是确定性的。
2. 消息段划分不会拆开工具调用和工具结果。
3. 孤立工具结果会报错。
4. 旧工具结果会按从旧到新的顺序压缩。
5. 最近 `8` 个消息段默认不会被局部压缩。
6. 已压缩工具结果不会重复压缩。
7. 手动整理会生成摘要消息并写回 Agent 历史。
8. 自动整理发生在 `model_request` 之前。
9. 自动整理失败会产生 `context_error`，不会继续请求模型。
10. CLI 支持 `/compact`、`--context-limit` 和自动整理提示。

因此，这个模块的效果可以直接通过 CLI / REPL 观察，而不是只能从内部 API 看见。
