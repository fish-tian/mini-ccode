import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { defineTool, type Tool } from "../tools/index.js";
import { isDirectory, isFile, resolveWorkspacePath } from "./path.js";
import {
  defaultSearchLimit,
  normalizeRelativePath,
  skipDirs,
  type FileToolsOptions
} from "./types.js";

export function createGlobTool(options: FileToolsOptions = {}): Tool {
  return defineTool({
    name: "glob",
    description: "Find workspace files by glob pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern such as **/*.ts." },
        path: { type: "string", description: "Optional directory to search." }
      },
      required: ["pattern"]
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async input => {
      const base = await resolveWorkspacePath(
        typeof input.path === "string" ? input.path : ".",
        options.workspaceRoot
      );
      if (!(await isDirectory(base.absolutePath))) {
        return { ok: true, content: `Error: not a directory: ${base.relativePath}` };
      }

      const pattern = String(input.pattern);
      const matcher = globMatcher(pattern);
      const files = (await walkFiles(base.absolutePath, options.workspaceRoot)).filter(file =>
        matcher(file.relativePath)
      );
      files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

      return {
        ok: true,
        content: formatLimitedResults(
          files.map(file => file.relativePath),
          options.searchLimit ?? defaultSearchLimit,
          "No files matched.",
          "matches"
        )
      };
    }
  });
}

export function createGrepTool(options: FileToolsOptions = {}): Tool {
  return defineTool({
    name: "grep",
    description: "Search text files by JavaScript regular expression.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression." },
        path: { type: "string", description: "Optional file or directory to search." },
        include: { type: "string", description: "Optional glob pattern for paths." }
      },
      required: ["pattern"]
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async input => {
      const regex = regexFrom(String(input.pattern));
      if (regex instanceof Error) {
        return { ok: true, content: `Invalid regex: ${regex.message}` };
      }

      const base = await resolveWorkspacePath(
        typeof input.path === "string" ? input.path : ".",
        options.workspaceRoot
      );
      const includeMatcher =
        typeof input.include === "string" ? globMatcher(input.include) : undefined;
      const files = await searchableFiles(base.absolutePath, base.relativePath, options);
      const matches: string[] = [];

      for (const file of [...files].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath)
      )) {
        if (includeMatcher !== undefined && !includeMatcher(file.relativePath)) {
          continue;
        }

        const content = await readFile(file.absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            matches.push(`${file.relativePath}:${index + 1}: ${line}`);
          }
        }
      }

      return {
        ok: true,
        content: formatLimitedResults(
          matches,
          options.searchLimit ?? defaultSearchLimit,
          "No matches found.",
          "matches"
        )
      };
    }
  });
}

type WalkFile = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

async function searchableFiles(
  absolutePath: string,
  relativePath: string,
  options: FileToolsOptions
): Promise<readonly WalkFile[]> {
  if (await isFile(absolutePath)) {
    return [{ absolutePath, relativePath }];
  }

  if (await isDirectory(absolutePath)) {
    return walkFiles(absolutePath, options.workspaceRoot);
  }

  return [];
}

async function walkFiles(
  rootAbsolutePath: string,
  workspaceRoot: string | undefined
): Promise<readonly WalkFile[]> {
  const workspace = await resolveWorkspacePath(".", workspaceRoot);
  const files: WalkFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && skipDirs.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: normalizeRelativePath(
            path.relative(workspace.absolutePath, absolutePath)
          )
        });
      }
    }
  }

  await visit(rootAbsolutePath);
  return files;
}

function regexFrom(pattern: string): RegExp | Error {
  try {
    return new RegExp(pattern);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function globMatcher(pattern: string): (value: string) => boolean {
  const normalizedPattern = normalizeRelativePath(pattern);
  const source = globToRegexSource(normalizedPattern);
  const regex = new RegExp(`^${source}$`);
  return value => regex.test(normalizeRelativePath(value));
}

function globToRegexSource(pattern: string): string {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 2;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegex(char ?? "");
    index += 1;
  }

  return source;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLimitedResults(
  values: readonly string[],
  limit: number,
  emptyMessage: string,
  noun: string
): string {
  if (values.length === 0) {
    return emptyMessage;
  }

  const selected = values.slice(0, limit);
  if (selected.length < values.length) {
    return `${selected.join("\n")}\n... (${values.length} ${noun}, showing first ${selected.length})`;
  }

  return selected.join("\n");
}
