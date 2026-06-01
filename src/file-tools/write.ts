import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool, type Tool } from "../tools/index.js";
import { resolveWorkspacePath } from "./path.js";
import type { FileToolsOptions } from "./types.js";

export function createWriteFileTool(options: FileToolsOptions = {}): Tool {
  return defineTool({
    name: "write_file",
    description: "Write UTF-8 text to a file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to write." },
        content: { type: "string", description: "Text content to write." }
      },
      required: ["file_path", "content"]
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    execute: async input => {
      const resolved = await resolveWorkspacePath(
        String(input.file_path),
        options.workspaceRoot
      );
      const content = String(input.content);

      await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, content, "utf8");

      return {
        ok: true,
        content: `Wrote ${lineCount(content)} lines to ${resolved.relativePath}`
      };
    }
  });
}

export function lineCount(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const newlineCount = [...content.matchAll(/\n/g)].length;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}
