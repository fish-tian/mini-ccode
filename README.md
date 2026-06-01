# Mini CCode

Mini CCode is a teaching-oriented TypeScript project that demonstrates how to build a small coding agent step by step.

It covers model interaction, the agent loop, tool execution, permissions, file operations, shell commands, session resume, context management, todo tracking, and sub-agent workflows.

## Run

```text
bun install
bun run mini-ccode -- "read package.json"
bun run mini-ccode -- "run the tests"
bun run mini-ccode
```

Useful modes:

```text
bun run mini-ccode -- --permission-mode read-only "review without changes"
bun run mini-ccode -- --permission-mode allow-all "run the tests without prompts"
bun run mini-ccode -- --resume <session-id> "continue the saved work"
```

## Documentation

The public teaching chapters are in `docs/`. Start from `docs/README.md` for the full reading order.

## Examples

- `examples/minivote`: a small full-stack voting app generated as a mini-ccode practice task.

Start with:

- `docs/01-project-skeleton.md`
- `docs/03-agent-loop.md`
- `docs/05-tool-system.md`
- `docs/06-permission.md`
- `docs/13-context.md`
- `docs/17-sub-agent.md`

## Scripts

```text
bun run typecheck
bun run lint
bun run test
```
