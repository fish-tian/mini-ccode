import { readFile } from "node:fs/promises";

import { defineTool, type Tool } from "../tools/index.js";
import { isFile, resolveWorkspacePath } from "./path.js";
import { defaultReadLimit, type FileToolsOptions } from "./types.js";

export function createReadFileTool(options: FileToolsOptions = {}): Tool {
  return defineTool({
    name: "read_file",
    description: "Read a text file inside the workspace and return numbered lines.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to read." },
        offset: { type: "number", description: "1-based first line to show." },
        limit: { type: "number", description: "Maximum number of lines to show." }
      },
      required: ["file_path"]
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async input => {
      const resolved = await resolveWorkspacePath(
        String(input.file_path),
        options.workspaceRoot
      );

      if (!(await isFile(resolved.absolutePath))) {
        return { ok: true, content: `Error: not a file: ${resolved.relativePath}` };
      }

      const offset = integerInput(input.offset, 1);
      const limit = integerInput(input.limit, options.readLimit ?? defaultReadLimit);
      if (offset < 1) {
        return { ok: true, content: "Error: offset must be greater than or equal to 1." };
      }
      if (limit < 1) {
        return { ok: true, content: "Error: limit must be greater than 0." };
      }

      const content = await readFile(resolved.absolutePath, "utf8");
      return { ok: true, content: formatNumberedLines(content, offset, limit) };
    }
  });
}

export function formatNumberedLines(content: string, offset: number, limit: number): string {
  if (content.length === 0) {
    return "(empty file)";
  }

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const startIndex = Math.min(offset - 1, lines.length);
  const selected = lines.slice(startIndex, startIndex + limit);
  const rendered = selected.map((line, index) => `${startIndex + index + 1}\t${line}`);

  if (startIndex + selected.length < lines.length) {
    rendered.push(
      `... (${lines.length} lines total, showing ${startIndex + 1}-${startIndex + selected.length})`
    );
  }

  return rendered.join("\n");
}

function integerInput(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}
