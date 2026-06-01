import type { Tool } from "../tools/types.js";
import {
  commandMatchesPrefixKey,
  isCommandToolName
} from "./command-rules.js";
import type { PermissionDecision, PermissionPolicy } from "./types.js";

const ALLOW: PermissionDecision = { behavior: "allow" };

export function allowAllPermissionPolicy(): PermissionPolicy {
  return {
    decide: () => ALLOW
  };
}

export function readOnlyPermissionPolicy(
  options: { readonly denyReason?: string } = {}
): PermissionPolicy {
  return {
    decide: ({ tool, input }) => {
      if (tool.name === "agent" && input.subagent_type === "explore") {
        return ALLOW;
      }

      if (tool.isReadOnly) {
        return ALLOW;
      }

      return {
        behavior: "deny",
        reason: options.denyReason ?? `Tool "${tool.name}" is not read-only.`
      };
    }
  };
}

export function interactivePermissionPolicy(options: {
  readonly sessionAllowedTools: ReadonlySet<string>;
  readonly sessionAllowedCommandPrefixes?: ReadonlySet<string>;
  readonly askReason?: string;
}): PermissionPolicy {
  return {
    decide: ({ tool, input }) => {
      if (tool.isReadOnly) {
        return ALLOW;
      }

      if (isCommandToolName(tool.name)) {
        const command = typeof input.command === "string" ? input.command : "";
        if (commandMatchesAnyPrefix(tool.name, command, options.sessionAllowedCommandPrefixes)) {
          return ALLOW;
        }
      } else if (matchesToolName(tool, options.sessionAllowedTools)) {
        return ALLOW;
      }

      return {
        behavior: "ask",
        reason: options.askReason ?? `Tool "${tool.name}" requires user approval.`
      };
    }
  };
}

function commandMatchesAnyPrefix(
  toolName: "powershell" | "bash",
  command: string,
  prefixes: ReadonlySet<string> | undefined
): boolean {
  if (prefixes === undefined) {
    return false;
  }

  for (const key of prefixes) {
    if (commandMatchesPrefixKey({ toolName, command, key })) {
      return true;
    }
  }

  return false;
}

export function createToolNamePermissionPolicy(options: {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  readonly ask?: readonly string[];
  readonly defaultDecision?: PermissionDecision;
}): PermissionPolicy {
  const allow = new Set(options.allow ?? []);
  const deny = new Set(options.deny ?? []);
  const ask = new Set(options.ask ?? []);
  const defaultDecision = options.defaultDecision ?? ALLOW;

  return {
    decide: ({ tool }) => {
      if (matchesToolName(tool, deny)) {
        return {
          behavior: "deny",
          reason: `Tool "${tool.name}" is denied by policy.`
        };
      }

      if (matchesToolName(tool, ask)) {
        return {
          behavior: "ask",
          reason: `Tool "${tool.name}" requires permission.`
        };
      }

      if (matchesToolName(tool, allow)) {
        return ALLOW;
      }

      return defaultDecision;
    }
  };
}

function matchesToolName(tool: Tool, names: ReadonlySet<string>): boolean {
  return names.has(tool.name) || (tool.aliases?.some(alias => names.has(alias)) ?? false);
}
