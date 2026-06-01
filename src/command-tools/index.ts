import type { Tool } from "../tools/index.js";
import { createCommandTool } from "./create-tool.js";
import type { CommandToolsOptions } from "./types.js";

export { createCommandTool } from "./create-tool.js";
export { runCommand } from "./runner.js";
export type {
  CommandRunner,
  CommandRunRequest,
  CommandRunResult,
  CommandShell,
  CommandToolsOptions
} from "./types.js";

export function createCommandTools(options: CommandToolsOptions = {}): readonly Tool[] {
  const shell = (options.platform ?? process.platform) === "win32" ? "powershell" : "bash";
  return [createCommandTool(shell, options)];
}
