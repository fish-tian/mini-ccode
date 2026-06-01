# 第 05 章：Tool System（工具系统）

## 本章目标

读完本章，你应该能理解：

- 工具定义、输入校验和执行结果为什么要结构化。
- 模型工具调用如何映射到本地函数。
- 为什么工具系统必须先于文件工具和命令工具完成。

## 这个模块解决什么问题

LLM 本身不会读文件，也不会跑命令。它只能生成文本。

编程 Agent 工具看起来像“会操作电脑”，本质上是因为模型会请求工具，程序再替它执行：

```text
用户：看看 src/index.ts
  -> 模型：我要调用 read_file({ path: "src/index.ts" })
  -> 工具系统：检查参数，执行工具，返回结果
  -> 模型：根据工具结果继续回答
```

Tool System 就是中间这层边界。它不让模型直接碰本地环境，而是让模型只能发起结构化请求。

## 编程 Agent 工具为什么需要它

如果没有工具系统，agent 很快会变成一堆危险的 if/else：

```text
如果模型说“读文件”，就 fs.readFile
如果模型说“跑测试”，就 shell exec
如果模型说“改代码”，就写文件
```

这会带来三个问题：

- 参数不稳定：模型可能传错字段或类型。
- 安全边界不清楚：危险操作可能绕过 Permission。
- 测试困难：自然语言指令很难稳定断言。

所以正确做法是把工具调用变成明确数据：

```ts
{
  id: "call_1",
  name: "echo",
  input: { text: "hello" }
}
```

程序只认这个结构，不猜自然语言。

## 最小实现

一个最小工具系统只需要四件事：

```text
ToolDefinition  定义工具是什么
ToolRegistry    保存和查找工具
validateInput   执行前检查参数
executeToolCall 执行并返回结构化结果
```

本章先讲最小闭环：

```text
ToolCall
  -> ToolRegistry.get(name)
  -> validateToolInput(schema, input)
  -> tool.execute(input)
  -> ToolExecutionResult
```

参数错误不会执行工具。工具抛异常也不会冲出系统，而是变成：

```ts
{
  ok: false,
  error: {
    code: "execution_error",
    message: "boom"
  }
}
```

现在 Agent Loop 已经会把这些结果写回 transcript，让模型修正下一步。后续章节会把同一条执行链扩展到文件工具、本地命令、Todo 和 Sub-Agent；这些都不是绕过 Tool System 的特殊通道。

## 本项目中的实现

当前代码在 `src/tools/`：

- `types.ts`：定义 `ToolDefinition`、`ToolCall`、`ToolResult`、`ToolExecutionResult`。
- `registry.ts`：实现 `ToolRegistry`，支持 name 和 alias 查找，并拒绝重名。
- `validation.ts`：实现轻量 JSON Schema 子集校验。
- `execute.ts`：实现 `executeToolCall()`。
- `index.ts`：导出 public API。

Agent Loop 也已经接上这条链路：

```text
MockModelProvider 返回 toolCalls
  -> Agent 产生 tool_call 事件
  -> executeToolCall()
  -> Agent 产生 tool_result 事件
  -> tool result 写回 history
  -> Agent 再次请求模型
```

一个测试工具长这样：

```ts
const echoTool = defineTool({
  name: "echo",
  aliases: ["repeat"],
  description: "Return the input text.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" }
    },
    required: ["text"]
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: input => ({
    ok: true,
    content: String(input.text)
  })
});
```

注意默认值是保守的：

```text
isReadOnly 默认 false
isConcurrencySafe 默认 false
```

也就是说，一个工具如果没有明确声明自己只读、可并发，系统不会替它假设安全。这一点来自 ccb 的设计思路。

## 教学版取舍

| 维度 | ccb 做法 | mini-ccode 当前实现 | 为什么先这样 |
|---|---|---|---|
| 用户可见能力 | 模型可以真实读写文件、跑命令、搜索、开子 Agent | 后续章节已把文件工具、本地命令、Todo 和 Sub-Agent 接到同一工具链 | 本章只解释工具系统边界，不把所有工具细节塞进第一步 |
| 工具对象 | 工具包含执行、权限、UI、上下文摘要、并发、安全标记、MCP 信息 | 工具只包含 schema、execute、只读/并发标记 | 先讲清楚“工具是什么”，再逐层加能力 |
| schema | Zod 和 JSON Schema 并存 | 手写轻量 JSON Schema 子集 | 当前参数简单，不为第一步引入新依赖 |
| 执行流程 | schema -> validateInput -> hooks -> permission -> call -> result mapping -> hooks | validate -> permission -> execute -> result | 先保留确定性执行壳，hooks 和并发后续再加 |
| 并发 | StreamingToolExecutor 可在模型还在输出时提前执行工具 | 单个工具调用串行执行 | 先保证测试和 transcript 稳定 |
| UI | React/Ink 渲染工具调用、进度和 diff | 无工具 UI | CLI / REPL 后续只消费工具事件 |

这不是逃避细节，而是拆层。ccb 的完整工具系统很强，但教学项目不能第一步就把所有能力塞进去。

工具系统在全书中的演进路线是：

```text
Tool System
  -> Agent Loop fake tool integration  已完成
  -> Permission                         已完成
  -> File Tools                         已完成
  -> Bash / PowerShell                  已完成
  -> Todo / Sub-Agent                   已完成
  -> Context / tool result compaction   已完成
  -> streaming tool execution
```

## 关键代码导读

`defineTool()` 在 `src/tools/types.ts`。

它做的事很少，但很关键：补默认值。默认不只读、默认不可并发，这是安全姿态。

`ToolRegistry` 在 `src/tools/registry.ts`。

它不是简单数组，因为工具名和 alias 都必须唯一。否则模型请求 `read` 时，系统不知道应该调用哪个工具。

`validateToolInput()` 在 `src/tools/validation.ts`。

当前支持：

- object schema
- required 字段
- string / number / boolean
- array
- array item 类型

额外字段当前允许。这样第一版不会过度严格，后续真实工具需要严格模式时再加。

`executeToolCall()` 在 `src/tools/execute.ts`。

这是执行管道：

```text
未知工具 -> unknown_tool
参数错误 -> invalid_input，且不执行
工具返回失败 -> 原样保留
工具抛异常 -> execution_error
工具成功 -> ok=true
```

## 常见误区

- 让模型输出自然语言命令，然后程序猜它想干什么。
- 参数不校验就执行工具。
- 工具抛异常时直接让 Agent Loop 崩掉。
- 一开始就实现 Bash，但没有 Permission。
- 一开始就实现文件写入，但没有路径边界。
- 把工具结果只做成字符串，后续无法区分成功、失败、权限拒绝。
- 默认把工具当只读或可并发。

## 可扩展方向

当前已经把 Agent Loop 接上工具事件：

```text
model_response(tool_call)
  -> tool_call
  -> tool_result
  -> next model_request
```

再往后：

- 更细的权限规则：路径级、命令级、插件级规则。
- 更丰富的工具 UI：进度、diff、分组和折叠。
- 更完整的工具结果管理：附件、缓存和可恢复 transcript。
- Streaming executor：等基础 transcript 稳定后，再考虑并发和提前执行。
