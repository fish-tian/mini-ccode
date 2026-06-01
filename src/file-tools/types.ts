export type FileToolsOptions = {
  readonly workspaceRoot?: string;
  readonly readLimit?: number;
  readonly searchLimit?: number;
};

export type ResolvedWorkspacePath = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

export const defaultReadLimit = 2000;
export const defaultSearchLimit = 100;

export const skipDirs = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "dist",
  "build",
  "coverage"
]);

export function normalizeRelativePath(pathname: string): string {
  return pathname.replaceAll("\\", "/");
}
