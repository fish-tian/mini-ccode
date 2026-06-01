import { buildDefaultSystemPrompt } from "./default-prompt.js";
import {
  loadProjectInstructions,
  projectInstructionsToMessage
} from "./project.js";
import type { InstructionOptions, InstructionResult } from "./types.js";

export async function createInstructionContext(
  options: InstructionOptions
): Promise<InstructionResult> {
  const projectInstructions = await loadProjectInstructions(options.workspaceRoot);
  const basePrompt =
    options.systemPrompt ?? buildDefaultSystemPrompt({
      workspaceRoot: options.workspaceRoot,
      tools: options.tools,
      permissionMode: options.permissionMode,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  const systemPrompt =
    options.appendSystemPrompt === undefined || options.appendSystemPrompt.length === 0
      ? basePrompt
      : [
          basePrompt,
          "",
          "# Additional System Instructions",
          options.appendSystemPrompt
        ].join("\n");

  return {
    systemPrompt,
    contextMessages:
      projectInstructions === undefined
        ? []
        : [projectInstructionsToMessage(projectInstructions)],
    ...(projectInstructions === undefined ? {} : { projectInstructions })
  };
}

