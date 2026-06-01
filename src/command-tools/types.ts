export type CommandShell = "bash" | "powershell";

export type CommandToolsOptions = {
  readonly workspaceRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
  readonly runner?: CommandRunner;
};

export type CommandRunRequest = {
  readonly shell: CommandShell;
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
};

export type CommandRunResult =
  | {
      readonly kind: "completed";
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number;
    }
  | { readonly kind: "timeout"; readonly timeoutMs: number };

export type CommandRunner = (request: CommandRunRequest) => Promise<CommandRunResult>;

export const defaultCommandTimeoutMs = 120_000;
export const maximumCommandTimeoutMs = 120_000;
export const defaultMaxOutputChars = 30_000;
