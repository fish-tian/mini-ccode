# Mini CCode

Mini CCode 是一个教学向的 TypeScript 项目，用来一步步拆解一个 Claude Code 风格的编程 Agent 是怎么工作的。

它不是生产级 Claude Code 替代品，而是一个可阅读、可测试、可逐章学习的小型实现。项目会按模块解释模型调用、Agent 循环、工具系统、权限控制、文件操作、命令执行、会话恢复、上下文管理、Todo 和 Sub-Agent 等能力。

## 当前能力

- CLI 和交互式 REPL 入口
- OpenAI-compatible 模型供应商接口和可确定测试的 Mock Provider
- 基于事件流的 Agent Loop
- 带类型定义的 Tool System
- `read-only`、默认询问、`allow-all` 权限模式
- 文件工具和本地命令工具
- 会话保存与 `--resume` 恢复
- 上下文管理、Todo 跟踪和 Sub-Agent 示例流程

## 快速开始

```text
bun install
bun run mini-ccode -- "read package.json"
bun run mini-ccode -- "run the tests"
bun run mini-ccode
```

常用模式：

```text
bun run mini-ccode -- --permission-mode read-only "review without changes"
bun run mini-ccode -- --permission-mode allow-all "run the tests without prompts"
bun run mini-ccode -- --resume <session-id> "continue the saved work"
```

## 教程文档

公开教学章节在 [docs/](./docs/) 目录中。完整阅读顺序见 [docs/README.md](./docs/README.md)。

建议先读：

- [第 01 章：项目骨架](./docs/01-project-skeleton.md)
- [第 02 章：模型供应商层](./docs/02-llm-provider.md)
- [第 03 章：Agent 循环](./docs/03-agent-loop.md)
- [第 05 章：工具系统](./docs/05-tool-system.md)
- [第 06 章：权限系统](./docs/06-permission.md)
- [第 08 章：文件工具](./docs/08-file-tools.md)
- [第 13 章：上下文整理](./docs/13-context.md)
- [第 17 章：Sub-Agent](./docs/17-sub-agent.md)

## 示例

- [examples/minivote](./examples/minivote)：一个用 mini-ccode 练习生成的小型全栈投票应用。

## 开发命令

```text
bun run typecheck
bun run lint
bun run test
```

## 开发流程

这个项目按模块推进。每个模块都要先研究参考实现，再写研究文档和设计文档，经过人工 review 后才进入实现、测试、教学文档和进度更新。
