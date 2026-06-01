import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { ResolvedWorkspacePath } from "./types.js";
import { normalizeRelativePath } from "./types.js";

export async function resolveWorkspacePath(
  requestedPath: string,
  workspaceRoot = process.cwd()
): Promise<ResolvedWorkspacePath> {
  if (requestedPath.trim().length === 0) {
    throw new Error("Path must not be empty.");
  }

  if (isUncPath(requestedPath)) {
    throw new Error("UNC paths are not supported.");
  }

  const rootAbsolute = path.resolve(workspaceRoot);
  const rootReal = await realpath(rootAbsolute);
  const targetAbsolute = path.resolve(
    path.isAbsolute(requestedPath) ? requestedPath : path.join(rootReal, requestedPath)
  );
  const boundaryCandidate = await boundaryPathFor(targetAbsolute);

  assertInsideRoot(boundaryCandidate, rootReal);
  assertInsideRoot(targetAbsolute, rootReal);

  return {
    absolutePath: targetAbsolute,
    relativePath: normalizeRelativePath(path.relative(rootReal, targetAbsolute))
  };
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(absolutePath: string): Promise<boolean> {
  return (await stat(absolutePath)).isFile();
}

export async function isDirectory(absolutePath: string): Promise<boolean> {
  return (await stat(absolutePath)).isDirectory();
}

function isUncPath(pathname: string): boolean {
  return /^[/\\]{2}/.test(pathname);
}

async function boundaryPathFor(targetAbsolute: string): Promise<string> {
  if (await pathExists(targetAbsolute)) {
    return realpath(targetAbsolute);
  }

  let current = path.dirname(targetAbsolute);
  while (!(await pathExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No existing parent directory for "${targetAbsolute}".`);
    }
    current = parent;
  }

  return realpath(current);
}

function assertInsideRoot(candidate: string, root: string): void {
  const relative = path.relative(root, candidate);
  const normalizedRelative = normalizeForCompare(relative);

  if (
    normalizedRelative === "" ||
    (!normalizedRelative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return;
  }

  throw new Error(`Path is outside workspace: ${candidate}`);
}

function normalizeForCompare(pathname: string): string {
  return process.platform === "win32" ? pathname.toLowerCase() : pathname;
}
