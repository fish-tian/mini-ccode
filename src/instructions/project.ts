import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentMessage } from "../agent/index.js";
import type { ProjectInstructions } from "./types.js";

export async function loadProjectInstructions(
  workspaceRoot: string
): Promise<ProjectInstructions | undefined> {
  const filePath = path.resolve(workspaceRoot, "AGENTS.md");

  try {
    const content = await readFile(filePath, "utf8");
    return {
      source: "AGENTS.md",
      path: filePath,
      content
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw new Error(
      `Unable to read project instructions at ${filePath}. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function projectInstructionsToMessage(
  instructions: ProjectInstructions
): AgentMessage {
  return {
    role: "user",
    content: [
      "<project-instructions>",
      `Source: ${instructions.source}`,
      `Path: ${instructions.path}`,
      "",
      instructions.content.trim(),
      "</project-instructions>"
    ].join("\n")
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
