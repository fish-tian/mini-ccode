export type CommandToolName = "powershell" | "bash";

export type CommandPermissionPrefix = {
  readonly toolName: CommandToolName;
  readonly prefix: string;
};

export type CommandPrefixSuggestion =
  | {
      readonly ok: true;
      readonly rule: CommandPermissionPrefix;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

const blockedPrefixes = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "del",
  "doas",
  "env",
  "erase",
  "fish",
  "nice",
  "nohup",
  "pkexec",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "rd",
  "remove-item",
  "removeitem",
  "rm",
  "rmdir",
  "sh",
  "stdbuf",
  "sudo",
  "timeout",
  "xargs",
  "zsh"
]);

const subcommandPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;

export function isCommandToolName(toolName: string): toolName is CommandToolName {
  return toolName === "powershell" || toolName === "bash";
}

export function commandMatchesPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = normalizeCommandText(command);
  const normalizedPrefix = normalizeCommandText(prefix);

  if (normalizedPrefix.length === 0) {
    return false;
  }

  return (
    normalizedCommand === normalizedPrefix ||
    normalizedCommand.startsWith(`${normalizedPrefix} `)
  );
}

export function suggestCommandPrefix(options: {
  readonly toolName: CommandToolName;
  readonly command: string;
}): CommandPrefixSuggestion {
  const normalized = normalizeCommandText(options.command);
  if (normalized.length === 0) {
    return { ok: false, reason: "Command is empty." };
  }

  const tokens = normalized.split(" ");
  const first = tokens[0];
  if (first === undefined) {
    return { ok: false, reason: "Command is empty." };
  }

  if (isBlockedPrefix(first)) {
    return { ok: false, reason: `Command prefix "${first}" is too broad or unsafe.` };
  }

  const second = tokens[1];
  const prefix =
    second !== undefined && subcommandPattern.test(second)
      ? `${first} ${second}`
      : first;

  if (isBlockedPrefix(prefix) || isBlockedPrefix(prefix.split(" ")[0] ?? prefix)) {
    return { ok: false, reason: `Command prefix "${prefix}" is too broad or unsafe.` };
  }

  return {
    ok: true,
    rule: {
      toolName: options.toolName,
      prefix
    }
  };
}

export function commandPrefixKey(rule: CommandPermissionPrefix): string {
  return `${rule.toolName}:${normalizeCommandText(rule.prefix)}`;
}

export function commandMatchesPrefixKey(options: {
  readonly toolName: CommandToolName;
  readonly command: string;
  readonly key: string;
}): boolean {
  const parsed = parseCommandPrefixKey(options.key);
  return (
    parsed !== undefined &&
    parsed.toolName === options.toolName &&
    commandMatchesPrefix(options.command, parsed.prefix)
  );
}

function parseCommandPrefixKey(key: string): CommandPermissionPrefix | undefined {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex < 0) {
    return undefined;
  }

  const toolName = key.slice(0, separatorIndex);
  if (!isCommandToolName(toolName)) {
    return undefined;
  }

  const prefix = key.slice(separatorIndex + 1);
  if (prefix.length === 0) {
    return undefined;
  }

  return { toolName, prefix };
}

function normalizeCommandText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isBlockedPrefix(prefix: string): boolean {
  return blockedPrefixes.has(prefix.toLowerCase());
}
