import type { Tool } from "../tools/index.js";
import { createEditFileTool } from "./edit.js";
import { createReadFileTool } from "./read.js";
import { createGlobTool, createGrepTool } from "./search.js";
import type { FileToolsOptions } from "./types.js";
import { createWriteFileTool } from "./write.js";

export { resolveWorkspacePath } from "./path.js";
export type { FileToolsOptions, ResolvedWorkspacePath } from "./types.js";

export function createFileTools(options: FileToolsOptions = {}): readonly Tool[] {
  return [
    createReadFileTool(options),
    createWriteFileTool(options),
    createEditFileTool(options),
    createGlobTool(options),
    createGrepTool(options)
  ];
}
