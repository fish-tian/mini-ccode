import {
  allowAllPermissionPolicy,
  commandPrefixKey,
  interactivePermissionPolicy,
  isCommandToolName,
  readOnlyPermissionPolicy,
  suggestCommandPrefix,
  type CommandPrefixSuggestion,
  type PermissionPolicy,
  type PermissionPrompt,
  type PermissionRequest
} from "../permission/index.js";
import type { CliInputReader } from "./input-reader.js";
import type { CliPermissionMode } from "./options.js";
import type { CliOutput } from "./render.js";

export type CliPermissionRuntime = {
  readonly policy: PermissionPolicy;
  readonly requestPermission?: PermissionPrompt;
};

export function createCliPermissionRuntime(options: {
  readonly mode: CliPermissionMode;
  readonly input: CliInputReader;
  readonly output: CliOutput;
}): CliPermissionRuntime {
  if (options.mode === "read-only") {
    return {
      policy: readOnlyPermissionPolicy({ denyReason: "CLI is running in read-only mode." })
    };
  }

  if (options.mode === "allow-all") {
    return { policy: allowAllPermissionPolicy() };
  }

  const sessionAllowedTools = new Set<string>();
  const sessionAllowedCommandPrefixes = new Set<string>();

  return {
    policy: interactivePermissionPolicy({
      sessionAllowedTools,
      sessionAllowedCommandPrefixes
    }),
    requestPermission: async request =>
      requestApproval(
        request,
        sessionAllowedTools,
        sessionAllowedCommandPrefixes,
        options.input,
        options.output
      )
  };
}

async function requestApproval(
  request: PermissionRequest,
  sessionAllowedTools: Set<string>,
  sessionAllowedCommandPrefixes: Set<string>,
  input: CliInputReader,
  output: CliOutput
) {
  const commandSuggestion = commandPrefixSuggestionForRequest(request);
  const commandTool = commandSuggestion !== undefined;
  output.writeStdout(formatApprovalPrompt(request, commandSuggestion));

  while (true) {
    const answer = (await input.question("> "))?.trim().toLowerCase();

    if (answer === "y") {
      return { behavior: "allow", scope: "once" } as const;
    }

    if (answer === "p" && commandSuggestion?.ok === true) {
      sessionAllowedCommandPrefixes.add(commandPrefixKey(commandSuggestion.rule));
      return { behavior: "allow", scope: "once" } as const;
    }

    if (answer === "a" && !commandTool) {
      sessionAllowedTools.add(request.tool.name);
      return { behavior: "allow", scope: "session" } as const;
    }

    if (answer === "n" || answer === undefined) {
      return {
        behavior: "deny",
        reason:
          answer === undefined ? "Approval input ended." : "User rejected the request."
      } as const;
    }

    output.writeStdout(formatInvalidApprovalInput(commandSuggestion));
  }
}

function formatApprovalPrompt(
  request: PermissionRequest,
  commandSuggestion: CommandPrefixSuggestion | undefined
): string {
  const lines = [`Approval required for ${request.tool.name}:`];

  if (request.tool.name === "write_file") {
    lines.push(`  File path: ${displayValue(request.input.file_path)}`);
    const content = stringValue(request.input.content);
    lines.push(`  New content: ${content.length} chars, preview "${preview(content)}"`);
  } else if (request.tool.name === "edit_file") {
    lines.push(`  File path: ${displayValue(request.input.file_path)}`);
    lines.push(`  Find text: "${preview(stringValue(request.input.old_string))}"`);
    lines.push(`  Replace text: "${preview(stringValue(request.input.new_string))}"`);
  } else if (commandSuggestion !== undefined) {
    lines.push(`  Command: "${visibleText(stringValue(request.input.command))}"`);
    if (commandSuggestion.ok) {
      lines.push(`  Suggested prefix: "${commandSuggestion.rule.prefix}"`);
    }
  } else {
    lines.push("  This tool may change state or perform a sensitive action.");
  }

  if (commandSuggestion !== undefined) {
    if (commandSuggestion.ok) {
      lines.push(
        "  Prefix approvals only last for this CLI process.",
        "Allow? [y] once  [p] this prefix for this process  [n] reject",
        ""
      );
    } else {
      lines.push(
        `  No reusable prefix is suggested: ${commandSuggestion.reason}`,
        "Allow? [y] once  [n] reject",
        ""
      );
    }
  } else {
    lines.push(
      `  Choosing a allows later ${request.tool.name} requests in this process.`,
      "Allow? [y] once  [a] this tool for this process  [n] reject",
      ""
    );
  }

  return lines.join("\n");
}

function formatInvalidApprovalInput(
  commandSuggestion: CommandPrefixSuggestion | undefined
): string {
  if (commandSuggestion === undefined) {
    return "Enter y to allow once, a to allow this tool for this process, or n to reject.\n";
  }

  if (commandSuggestion.ok) {
    return "Enter y to allow once, p to allow this command prefix for this process, or n to reject.\n";
  }

  return "Command tools only support y (allow once) or n (reject) for this command.\n";
}

function commandPrefixSuggestionForRequest(
  request: PermissionRequest
): CommandPrefixSuggestion | undefined {
  if (!isCommandToolName(request.tool.name)) {
    return undefined;
  }

  return suggestCommandPrefix({
    toolName: request.tool.name,
    command: stringValue(request.input.command)
  });
}

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : "(not provided)";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function preview(value: string): string {
  const singleLine = visibleText(value);
  return singleLine.length <= 80 ? singleLine : `${singleLine.slice(0, 77)}...`;
}

function visibleText(value: string): string {
  return value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
}
