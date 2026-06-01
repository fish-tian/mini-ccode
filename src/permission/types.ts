import type { Tool, ToolExecutionContext } from "../tools/types.js";

export type PermissionBehavior = "allow" | "deny" | "ask";

export type PermissionDecision =
  | { readonly behavior: "allow"; readonly reason?: string }
  | { readonly behavior: "deny"; readonly reason: string }
  | { readonly behavior: "ask"; readonly reason: string };

export type PermissionApproval =
  | { readonly behavior: "allow"; readonly scope: "once" | "session" }
  | { readonly behavior: "deny"; readonly reason?: string };

export type PermissionRequest = {
  readonly tool: Tool;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: ToolExecutionContext;
};

export type PermissionPrompt = (
  request: PermissionRequest
) => Promise<PermissionApproval>;

export type PermissionPolicy = {
  readonly decide: (
    request: PermissionRequest
  ) => Promise<PermissionDecision> | PermissionDecision;
};
