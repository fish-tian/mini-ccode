const defaultMaxResultChars = 5000;
const defaultResultHeadChars = 4500;
const truncatedSuffix = "\n... (sub-agent output truncated)";

export function truncateSubAgentResult(
  content: string,
  maxChars = defaultMaxResultChars
): string {
  if (content.length <= maxChars) {
    return content;
  }

  const headChars = Math.min(defaultResultHeadChars, maxChars);
  return `${content.slice(0, headChars)}${truncatedSuffix}`;
}

export function formatSubAgentSuccess(content: string): string {
  return `[Sub-agent completed]\n${content}`;
}

export function formatSubAgentError(message: string): string {
  return `Sub-agent error: ${message}`;
}
