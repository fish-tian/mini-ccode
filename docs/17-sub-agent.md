# Sub-Agent 教学文档

## 这个模块解决什么问题

Sub-Agent 是“父 Agent 通过工具创建子 Agent”的能力。父 Agent 不把所有搜索、尝试和中间推理都塞进自己的历史，而是把一个完整子任务交给另一个独立上下文执行。子 Agent 完成后，只把总结作为 `agent` 工具结果返回给父 Agent。

最小模型是：

```text
用户输入
  -> 父 Agent 推理
  -> 父 Agent 调用 agent 工具
  -> agent 工具创建子 Agent
  -> 子 Agent 独立运行
  -> 子 Agent 总结返回给父 Agent
  -> 父 Agent 继续下一轮
```

这里的关键不是多开一个进程，而是多开一条 Agent 循环。`agent` 本身仍然是普通工具，必须经过 Tool System 和 Permission。

## 编程 Agent 工具为什么需要它

长任务里经常有大量“局部研究”：读很多文件、搜索调用链、验证一个假设、整理风险。如果这些过程全部进入父 Agent 历史，父上下文会很快变重，并且后续推理会被大量中间细节干扰。

Sub-Agent 的价值是隔离：

| 边界 | 作用 |
|---|---|
| 上下文边界 | 子 Agent 从独立消息历史开始，父 Agent 只接收结论 |
| 工具边界 | 子 Agent 拿到经过筛选的工具列表 |
| 权限边界 | 子 Agent 内部写文件和命令仍走现有 Permission |
| 可见性边界 | 子 Agent 的工具事件会转发给 CLI，避免隐藏修改过程 |

## 最小实现

最小可用版本只需要四件事：

1. 一个模型可调用的 `agent` 工具。
2. `agent` 工具内部创建新的 `Agent` 实例。
3. 子 Agent 使用筛选后的工具列表，不能再调用 `agent`。
4. 子 Agent 最终文本被包装成父 Agent 的 tool result。

伪代码如下：

```ts
const child = new Agent({
  provider,
  tools: new ToolRegistry(childTools),
  systemPrompt: buildSubAgentSystemPrompt(type),
  permissionPolicy,
  requestPermission
});

const result = await child.run(prompt);
return `[Sub-agent completed]\n${result.content}`;
```

第一版不做后台任务、消息通道、worktree 或团队协作，因为这些都需要额外生命周期管理。

## 本项目中的实现

mini-ccode 第一版内置两类子 Agent：

| 类型 | 用途 | 工具边界 |
|---|---|---|
| `general` | 普通子任务，可研究、修改、验证 | 父 CLI 工具列表去掉 `agent` |
| `explore` | 只读研究 | 只有 `read_file`、`glob`、`grep` |

`general` 可以使用 `TodoWrite`、文件写入工具和本地命令工具，但敏感操作不会绕过权限。默认模式会询问用户，`read-only` 会拒绝普通 `general`，`allow-all` 会允许。

`explore` 在 `read-only` 模式下可以运行，因为它只拿只读文件工具。这个判断发生在 Permission 策略里，不是绕过权限系统。

子 Agent 的系统提示词借鉴了 ccb 的内置 Agent 写法，但按 mini-ccode 当前能力收窄：

| 类型 | 借鉴点 | mini-ccode 收窄点 |
|---|---|---|
| `general` | 强调代码搜索、多文件分析、复杂问题调查、少创建新文件、最终给简洁报告 | 只使用当前 CLI 已有工具；写文件和命令继续走现有 Permission |
| `explore` | 明确只读、强调搜索策略、禁止修改文件、要求快速报告发现 | 不允许 Bash 只读命令，只给 `read_file`、`glob`、`grep` |

父 Agent 的默认系统提示词也借鉴了 ccb 的 Agent 工具说明：fresh sub-agent 没有看过当前对话，所以 `prompt` 必须包含目标、背景、已知信息和期望报告形态；不能写“根据你的发现修复它”这种模糊指令。

子 Agent 的工具事件会通过 `sub_agent_event` 转发给父 Agent：

```text
[tool] agent
  [sub-agent tool] read_file
  [sub-agent tool] edit_file
[tool result] [Sub-agent completed]
...
```

这样用户能看到子 Agent 做了什么，尤其是 `general` 修改文件或运行命令时不会变成隐藏行为。

## Todo 分区

`TodoWrite` 的语义是“写入当前完整 todo 列表”。如果父 Agent 和子 Agent 共用同一个列表，子 Agent 一次 `TodoWrite` 就会覆盖父 Agent 的计划。

所以本模块把 Todo 状态扩展为按 owner 分区：

```text
main                  父 Agent todo
subagent:<slug>       子 Agent todo
```

父 Agent 的 `TodoWrite` 写入 `main`。`general` 子 Agent 的 `TodoWrite` 写入自己的 `subagent:<slug>`。`explore` 不注册 `TodoWrite`。

Session 第一版仍只从父 Agent 历史恢复 `main` todo。原因是子 Agent transcript 第一版不持久化，恢复子 Agent todo 但没有对应子 Agent 历史，会让状态来源不清楚。

## 教学版取舍

| 层次 | ccb 做法 | mini-ccode 当前版本 | 原因 |
|---|---|---|---|
| Agent 类型 | 内置、用户、项目、插件等多来源 | 仅 `general` 和 `explore` | 保持教学版边界清楚 |
| 执行模式 | 同步、后台、remote、worktree、fork | 仅前台同步 | 后台和隔离目录需要独立生命周期设计 |
| 工具解析 | 按 Agent 定义解析 allowlist / denylist | `general` 继承父工具去掉 `agent`，`explore` 固定只读文件工具 | 先实现核心语义 |
| UI | 有复杂进度分组 | CLI 缩进渲染子事件 | 先保证过程可观察 |
| transcript | 可记录 sidechain | 子 Agent 历史不进入 Session | 避免引入持久化边界 |
| Todo | AppState 按 agentId 管理 | 最小 owner 分区 | 只补当前需要的隔离 |

当前版本复制的是核心语义：父 Agent 通过工具创建子 Agent、子 Agent 独立上下文运行、工具列表受控、结果回到父 Agent、过程可见。

## 关键代码导读

| 文件 | 作用 |
|---|---|
| `src/sub-agent/tool.ts` | 定义 `agent` 工具、输入校验、执行入口 |
| `src/sub-agent/run.ts` | 创建子 Agent、筛选工具、收集结果、转发事件 |
| `src/sub-agent/prompt.ts` | `general` 和 `explore` 的子 Agent 系统提示词 |
| `src/sub-agent/result.ts` | 成功/失败结果格式和结果截断 |
| `src/agent/agent.ts` | 接收工具运行时事件，并在 tool result 前转发 |
| `src/todo/state.ts` | Todo owner 分区 |
| `src/permission/policies.ts` | `read-only` 下允许 `explore`、拒绝 `general` |
| `src/cli/run.ts` | 默认 CLI 注册 `agent` 工具 |
| `src/cli/render.ts` | 渲染子 Agent 工具事件和子 Agent todo |

## 常见误区

- 把 Sub-Agent 当成用户手动调用的命令。实际是父 Agent 的模型调用 `agent` 工具。
- 让子 Agent 继承父 Agent 完整历史。第一版应该让父 Agent 写完整 `prompt`，子 Agent 从独立上下文开始。
- 只返回最终结果，不显示子 Agent 工具事件。普通子 Agent 能改文件，过程必须可见。
- 让子 Agent 继续调用 `agent`。这会带来递归成本、权限和调试问题。
- 让子 Agent 和父 Agent 共用同一个 Todo 列表。`TodoWrite` 会覆盖完整列表，必须分区。

## 可扩展方向

后续如果要接近 ccb，应该分模块增加：

- 自定义 Agent 定义：用户、项目、插件来源。
- 后台 Agent：任务注册、通知、继续通信和 transcript 持久化。
- SendMessage：给后台 Agent 发送后续消息。
- worktree 隔离：创建、保留、清理和合并 Git worktree。
- 子 Agent transcript：保存和回看 sidechain 历史。
- 更完整的 UI：按子 Agent 分组显示进度、工具和结果。
