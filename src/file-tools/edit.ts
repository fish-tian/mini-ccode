import { readFile, writeFile } from "node:fs/promises";

import { defineTool, type Tool } from "../tools/index.js";
import { compactUnifiedDiff } from "./diff.js";
import { isFile, resolveWorkspacePath } from "./path.js";
import type { FileToolsOptions } from "./types.js";

export function createEditFileTool(options: FileToolsOptions = {}): Tool {
  return defineTool({
    name: "edit_file",
    description: "Replace one exact string in a workspace file.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to edit." },
        old_string: { type: "string", description: "Existing exact text." },
        new_string: { type: "string", description: "Replacement text." }
      },
      required: ["file_path", "old_string", "new_string"]
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    execute: async input => {
      const resolved = await resolveWorkspacePath(
        String(input.file_path),
        options.workspaceRoot
      );
      const oldString = String(input.old_string);
      const newString = String(input.new_string);

      if (oldString.length === 0) {
        return { ok: true, content: "Error: old_string must not be empty." };
      }
      if (oldString === newString) {
        return { ok: true, content: "Error: old_string and new_string are identical." };
      }
      if (!(await isFile(resolved.absolutePath))) {
        return { ok: true, content: `Error: file not found: ${resolved.relativePath}` };
      }

      const before = await readFile(resolved.absolutePath, "utf8");
      const count = occurrenceCount(before, oldString);
      if (count === 0) {
        return {
          ok: true,
          content: `Error: old_string not found in ${resolved.relativePath}. Read the file again before editing.`
        };
      }
      if (count > 1) {
        return {
          ok: true,
          content: `Error: old_string appears ${count} times in ${resolved.relativePath}. Include more surrounding context.`
        };
      }

      const after = before.replace(oldString, newString);
      await writeFile(resolved.absolutePath, after, "utf8");

      return {
        ok: true,
        content: compactUnifiedDiff(resolved.relativePath, before, after)
      };
    }
  });
}

function occurrenceCount(content: string, needle: string): number {
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}
