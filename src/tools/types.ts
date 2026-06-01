import type { PermissionPolicy, PermissionPrompt } from "../permission/types.js";

export type ToolSchemaProperty =
  | { readonly type: "string"; readonly description?: string }
  | { readonly type: "number"; readonly description?: string }
  | { readonly type: "boolean"; readonly description?: string }
  | {
      readonly type: "array";
      readonly items?: ToolSchemaProperty;
      readonly description?: string;
    }
  | {
      readonly type: "object";
      readonly properties?: Readonly<Record<string, ToolSchemaProperty>>;
      readonly required?: readonly string[];
      readonly description?: string;
    };

export type ToolInputSchema = {
  readonly type: "object";
  readonly properties?: Readonly<Record<string, ToolSchemaProperty>>;
  readonly required?: readonly string[];
};

export type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type ToolExecutionError = {
  readonly code:
    | "unknown_tool"
    | "invalid_input"
    | "permission_denied"
    | "execution_error";
  readonly message: string;
};

export type ToolResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly error: ToolExecutionError };

export type ToolExecutionResult = {
  readonly callId: string;
  readonly toolName: string;
} & ToolResult;

export type ToolExecutionContext = {
  readonly signal?: AbortSignal;
  readonly permissionPolicy?: PermissionPolicy;
  readonly requestPermission?: PermissionPrompt;
  readonly emitEvent?: (event: ToolRuntimeEvent) => void;
};

export type ToolRuntimeEvent = {
  readonly type: "sub_agent_event";
  readonly description: string;
  readonly event: unknown;
};

export type ToolDefinition<
  Input extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>
> = {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly isReadOnly?: boolean;
  readonly isConcurrencySafe?: boolean;
  readonly execute: (
    input: Input,
    context: ToolExecutionContext
  ) => Promise<ToolResult> | ToolResult;
};

export type Tool<
  Input extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>
> = Omit<ToolDefinition<Input>, "isReadOnly" | "isConcurrencySafe"> & {
  readonly isReadOnly: boolean;
  readonly isConcurrencySafe: boolean;
};

export function defineTool<
  Input extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>
>(definition: ToolDefinition<Input>): Tool<Input> {
  return {
    ...definition,
    isReadOnly: definition.isReadOnly ?? false,
    isConcurrencySafe: definition.isConcurrencySafe ?? false
  };
}
