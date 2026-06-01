# Project Skeleton 教学文档

## 这个模块解决什么问题

Project Skeleton 解决的是“项目怎么开始”的问题。

做编程 Agent 工具时，最容易犯的错误是直接写 agent loop：接一个模型 API、让模型输出工具调用、再执行工具。这样很快能跑出 demo，但后面会遇到模块边界混乱、权限绕过、上下文无限膨胀、测试不可重复、文档跟不上实现等问题。

Project Skeleton 不写 agent 逻辑。它先建立工程结构、脚本入口、测试入口和最小类型导出，让后续每个模块都能按同一个节奏推进。

## 编程 Agent 工具为什么需要它

编程 Agent 工具不是一个普通 chat completion 包装器。它通常包含：

- 模型供应商抽象
- agent loop
- 工具注册和调用
- 权限系统
- 文件编辑
- shell 命令执行
- session 恢复
- 上下文裁剪
- 项目规则加载
- 子 agent
- hooks 和插件

这些模块彼此会互相影响。比如 File Tools 不能绕过 Permission，Agent Loop 不能直接假设工具一定成功，Context 不能无限追加历史。

所以项目一开始需要先定义开发闭环：

1. 先确定本章要交付的最小可观察能力。
2. 再写清楚模块边界。
3. 实现时只改当前模块需要的代码。
4. 补测试证明行为可重复。
5. 写教学文档解释为什么这样拆。

这让项目保持可解释、可审阅、可测试。

## 最小实现

Project Skeleton 的最小实现包括：

- `README.md`：公开项目入口，说明项目是什么、怎么运行、从哪里读教学章节。
- `docs/`：公开教学文档，按章节讲解每个功能如何加入项目。
- `package.json`：定义 `typecheck`、`lint`、`test` 和 CLI 运行脚本。
- `tsconfig.json`：开启 TypeScript strict。
- `eslint.config.js`：建立 lint 入口。
- `vitest.config.ts`：建立测试入口。
- `src/index.ts`：导出最小 typed placeholder。
- `tests/scaffold.test.ts`：验证 scaffold 能被测试框架加载。

这里的关键是“最小但完整”：能装依赖、能类型检查、能 lint、能测试，但不提前实现任何 agent 行为。

## 本项目中的实现

本项目选择 Bun + TypeScript + Vitest + ESLint。

这个选择适合教学项目：

- TypeScript 能把消息、工具、权限、事件这些边界显式类型化。
- Bun 让脚本和测试入口保持简单。
- Vitest 能快速写单元测试和集成测试。
- ESLint 和 TypeScript strict 是基础质量门。
- Markdown 文档足够轻，适合按章节递进讲解。

后续只有在模块复杂度真的需要时，才考虑拆包、加 CI、加文档站或引入更复杂工具链。

## 教学版取舍

生产级系统通常会从一开始就包含 CLI、UI、工具、模型 provider、MCP、文档站、发布流程和大量测试辅助设施。这个结构适合完整产品，但对教学项目的第一天来说太重。

mini-ccode 当前的 Project Skeleton 更像一张清晰的施工图：

```text
README 先说明入口
docs 按章节解释能力
src 只放最小 typed placeholder
tests 先证明测试入口可用
后续每个模块再逐步扩展
```

差异可以这样看：

| 维度 | 生产级系统常见做法 | mini-ccode 当前实现 |
|---|---|---|
| 仓库形态 | 多包仓库，包含产品、文档、发布和测试辅助设施 | Bun + TypeScript 单包项目 |
| 文档系统 | 完整文档站和架构页面 | Markdown 教学章节 |
| 测试入口 | 覆盖生产系统里的多类行为 | 先建立 typecheck、lint、unit test 三个质量门 |
| 模块边界 | 已经承载真实 agent、工具、UI、provider 等复杂协作 | 只建立骨架，不提前实现行为 |
| 教学目的 | 从完整系统里解释架构 | 从最小骨架逐步长出架构 |

这不是否定生产级结构，而是学习顺序不同：先把每个核心概念讲清楚，再决定什么时候需要拆包、文档站、CI 或发布流程。

## 关键代码导读

- `README.md`
  - 项目的公开入口。
  - 说明运行方式和教学文档位置。

- `docs/`
  - 每章解释一个模块。
  - 重点讲功能为什么需要、最小实现是什么、当前项目怎么接入。

- `src/index.ts`
  - 只导出 `projectName`、`ModuleStatus`、`ModuleDescriptor` 和 `scaffoldModules`。
  - 这些是 placeholder，不是最终 agent API。

- `tests/scaffold.test.ts`
  - 验证当前工程能正常运行测试。
  - 验证 placeholder 模块列表存在。

## 常见误区

- 把 scaffold 当成 agent 实现的开始，直接写模型调用。
- 一开始就复制大型工程结构，导致教学项目难以理解。
- 一开始就把所有模块接口都定死，后续无法根据实现反馈调整。
- 测试框架等到 agent loop 写完才加，导致行为不可回放。
- placeholder 里偷偷放业务逻辑，污染模块边界。
- 教学文档只列 API，不解释为什么这样设计。

## 可扩展方向

Project Skeleton 后续可以增强：

- 增加 GitHub Actions，运行 typecheck、lint、test。
- 增加 coverage 报告。
- 增加 golden transcript 测试目录和 fixture 格式。
- 增加 fixture repo 测试目录。
- 增加文档站生成，但不应早于核心教学文档稳定。

这些增强都应该作为后续明确模块或维护任务处理，不应混进当前 scaffold。
