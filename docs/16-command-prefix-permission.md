# 命令前缀审批教学文档

## 1. 这个模块改变了什么

mini-ccode 的默认模式以前会在每条本地命令执行前询问用户。现在仍然会询问未知命令，但用户可以把一个更窄的命令前缀临时放行。

```text
Approval required for powershell:
  Command: "bun run test -- tests/cli-run.test.ts"
  Suggested prefix: "bun run"
Allow? [y] once  [p] this prefix for this process  [n] reject
```

选择 `p` 后，本次命令会执行；同一个 CLI 进程内，后续以 `bun run` 开头的命令不再重复询问。

## 2. 为什么不是允许整个 powershell

`powershell` 和 `bash` 是命令解释器工具。允许整个工具等于允许后续任意命令：

```text
powershell: allow session  ->  任何 Remove-Item / Invoke-WebRequest / git push 都可能直接执行
```

命令前缀审批把范围收窄到用户看见并确认过的一类命令：

```text
prefix = "bun run"
允许:   bun run test
允许:   bun run build
不允许: git status
不允许: powershell -Command ...
```

## 3. 前缀如何匹配

匹配规则是空白边界匹配：

```text
command === prefix
command startsWith(prefix + whitespace)
```

因此 `bun run` 不会错误匹配 `bun runtime`。规则只保存在当前进程内；退出 CLI、重新启动或通过 `--resume` 恢复会话都不会恢复旧授权。

## 4. 这不是语法安全分析

本模块不会解析完整 PowerShell 或 Bash 语法。它只做轻量文本前缀建议，并禁止明显过宽的前缀，例如 `powershell`、`bash`、`cmd`、`sudo`、`rm`、`Remove-Item`。

用户仍然需要看清完整命令。`p` 的含义是“这个前缀在当前进程内我愿意信任”，不是“系统证明这条命令安全”。

## 5. 教学版取舍

| 层次 | ccb 做法 | mini-ccode 当前实现 |
|---|---|---|
| 规则种类 | exact / prefix / wildcard，多来源规则 | 仅当前进程内 prefix |
| PowerShell 分析 | 解析命令、别名、管道、只读判断 | 不做语法分析 |
| 持久化 | 可写入配置并管理 | 不持久化 |
| sandbox | 可选执行隔离 | 无执行隔离 |

mini-ccode 复制的是最核心边界：shell 权限不能按工具名整体放开，而要按命令内容收窄。
