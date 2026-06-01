import {
  allowAllPermissionPolicy,
  interactivePermissionPolicy,
  readOnlyPermissionPolicy,
  type PermissionPolicy
} from "../permission/index.js";

export type CliPermissionMode = "default" | "read-only" | "allow-all";

export type ParsedCliArgs =
  | {
      readonly ok: true;
      readonly prompt: string;
      readonly permissionMode: CliPermissionMode;
      readonly contextLimit: number;
      readonly systemPrompt?: string;
      readonly appendSystemPrompt?: string;
      readonly resumeSessionId?: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const defaultPermissionMode: CliPermissionMode = "default";
const defaultContextLimit = 128_000;

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const promptParts: string[] = [];
  let permissionMode = defaultPermissionMode;
  let contextLimit = defaultContextLimit;
  let hasPermissionMode = false;
  let hasContextLimit = false;
  let systemPrompt: string | undefined;
  let appendSystemPrompt: string | undefined;
  let resumeSessionId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!isCliFlag(arg)) {
      promptParts.push(arg ?? "");
      continue;
    }

    if (arg === "--permission-mode") {
      if (hasPermissionMode) {
        return {
          ok: false,
          message: "--permission-mode may be specified only once."
        };
      }

      const value = args[index + 1];
      if (value === undefined || isCliFlag(value)) {
        return {
          ok: false,
          message: "Missing value for --permission-mode. Expected: default, read-only, or allow-all."
        };
      }

      if (!isCliPermissionMode(value)) {
        return {
          ok: false,
          message: `Invalid permission mode "${value}". Expected: default, read-only, or allow-all.`
        };
      }

      permissionMode = value;
      hasPermissionMode = true;
      index += 1;
      continue;
    }

    if (arg === "--context-limit") {
      if (hasContextLimit) {
        return {
          ok: false,
          message: "--context-limit may be specified only once."
        };
      }

      const value = args[index + 1];
      if (value === undefined || isCliFlag(value)) {
        return {
          ok: false,
          message: "Missing value for --context-limit. Expected an integer token limit."
        };
      }

      const parsedLimit = Number(value);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 100) {
        return {
          ok: false,
          message: `Invalid context limit "${value}". Expected an integer token limit of at least 100.`
        };
      }

      contextLimit = parsedLimit;
      hasContextLimit = true;
      index += 1;
      continue;
    }

    if (arg === "--system-prompt") {
      if (systemPrompt !== undefined) {
        return {
          ok: false,
          message: "--system-prompt may be specified only once."
        };
      }

      const value = args[index + 1];
      if (value === undefined || isCliFlag(value)) {
        return {
          ok: false,
          message: "Missing value for --system-prompt. Expected prompt text."
        };
      }

      systemPrompt = value;
      index += 1;
      continue;
    }

    if (arg === "--append-system-prompt") {
      if (appendSystemPrompt !== undefined) {
        return {
          ok: false,
          message: "--append-system-prompt may be specified only once."
        };
      }

      const value = args[index + 1];
      if (value === undefined || isCliFlag(value)) {
        return {
          ok: false,
          message: "Missing value for --append-system-prompt. Expected prompt text."
        };
      }

      appendSystemPrompt = value;
      index += 1;
      continue;
    }

    if (arg === "--resume" && resumeSessionId !== undefined) {
      return {
        ok: false,
        message: "--resume may be specified only once."
      };
    }

    const value = args[index + 1];
    if (value === undefined || isCliFlag(value)) {
      return {
        ok: false,
        message: "Missing value for --resume. Expected a session UUID."
      };
    }

    if (!isSessionId(value)) {
      return {
        ok: false,
        message: `Invalid session id "${value}". Expected a UUID.`
      };
    }

    resumeSessionId = value;
    index += 1;
  }

  return {
    ok: true,
    prompt: promptParts.join(" ").trim(),
    permissionMode,
    contextLimit,
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(appendSystemPrompt === undefined ? {} : { appendSystemPrompt }),
    ...(resumeSessionId === undefined ? {} : { resumeSessionId })
  };
}

export function permissionPolicyForCliMode(mode: CliPermissionMode): PermissionPolicy {
  if (mode === "default") {
    return interactivePermissionPolicy({ sessionAllowedTools: new Set() });
  }

  return mode === "read-only"
    ? readOnlyPermissionPolicy({ denyReason: "CLI is running in read-only mode." })
    : allowAllPermissionPolicy();
}

function isCliPermissionMode(value: string): value is CliPermissionMode {
  return value === "default" || value === "read-only" || value === "allow-all";
}

function isCliFlag(value: string | undefined): boolean {
  return (
    value === "--permission-mode" ||
    value === "--resume" ||
    value === "--context-limit" ||
    value === "--system-prompt" ||
    value === "--append-system-prompt"
  );
}

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
