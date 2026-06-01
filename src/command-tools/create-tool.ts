import path from "node:path";

import { defineTool, type Tool, type ToolResult } from "../tools/index.js";
import { runCommand } from "./runner.js";
import {
  defaultCommandTimeoutMs,
  defaultMaxOutputChars,
  maximumCommandTimeoutMs,
  type CommandRunResult,
  type CommandShell,
  type CommandToolsOptions
} from "./types.js";

export function createCommandTool(
  shell: CommandShell,
  options: CommandToolsOptions = {}
): Tool {
  const cwd = path.resolve(options.workspaceRoot ?? process.cwd());
  const runner = options.runner ?? runCommand;
  const timeoutMs = options.timeoutMs ?? defaultCommandTimeoutMs;
  const maxOutputChars = options.maxOutputChars ?? defaultMaxOutputChars;

  return defineTool({
    name: shell,
    description:
      shell === "powershell"
        ? "Run a PowerShell command in the workspace."
        : "Run a Bash command in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command text to execute." },
        timeout_ms: {
          type: "number",
          description: "Optional timeout in milliseconds, up to 120000."
        }
      },
      required: ["command"]
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    execute: async (input, context) => {
      const command = String(input.command);
      if (command.trim().length === 0) {
        return invalidInput("Command must not be empty.");
      }

      const requestedTimeout = input.timeout_ms ?? timeoutMs;
      if (
        typeof requestedTimeout !== "number" ||
        !Number.isInteger(requestedTimeout) ||
        requestedTimeout < 1 ||
        requestedTimeout > maximumCommandTimeoutMs
      ) {
        return invalidInput(
          `timeout_ms must be an integer between 1 and ${maximumCommandTimeoutMs}.`
        );
      }

      const result = await runner({
        shell,
        command,
        cwd,
        timeoutMs: requestedTimeout,
        ...(context.signal === undefined ? {} : { signal: context.signal })
      });

      return {
        ok: true,
        content: truncateOutput(formatCommandResult(result), maxOutputChars)
      };
    }
  });
}

function invalidInput(message: string): ToolResult {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message
    }
  };
}

function formatCommandResult(result: CommandRunResult): string {
  if (result.kind === "timeout") {
    return `Command timed out after ${result.timeoutMs} ms.`;
  }

  const parts: string[] = [];
  const stdout = trimTrailingLineBreaks(result.stdout);
  const stderr = trimTrailingLineBreaks(result.stderr);

  if (stdout.length > 0) {
    parts.push(stdout);
  }
  if (stderr.length > 0) {
    parts.push(`[stderr]\n${stderr}`);
  }
  if (result.exitCode !== 0) {
    parts.push(`[exit code: ${result.exitCode}]`);
  }

  return parts.length === 0 ? "(no output)" : parts.join("\n");
}

function trimTrailingLineBreaks(value: string): string {
  return value.replace(/(?:\r?\n)+$/u, "");
}

function truncateOutput(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  const marker = "\n... output truncated ...\n";
  const remaining = limit - marker.length;
  if (remaining <= 0) {
    return value.slice(0, limit);
  }

  const startLength = Math.ceil(remaining / 2);
  const endLength = remaining - startLength;
  return `${value.slice(0, startLength)}${marker}${value.slice(value.length - endLength)}`;
}
