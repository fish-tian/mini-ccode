export function compactUnifiedDiff(
  relativePath: string,
  before: string,
  after: string
): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const firstChanged = firstDifferentIndex(beforeLines, afterLines);

  if (firstChanged === -1) {
    return `--- a/${relativePath}\n+++ b/${relativePath}\n@@\n`;
  }

  const lastBeforeChanged = lastDifferentIndex(beforeLines, afterLines, firstChanged);
  const lastAfterChanged = lastDifferentIndex(afterLines, beforeLines, firstChanged);
  const contextStart = Math.max(0, firstChanged - 3);
  const beforeContextEnd = Math.min(beforeLines.length - 1, lastBeforeChanged + 3);
  const afterContextEnd = Math.min(afterLines.length - 1, lastAfterChanged + 3);

  const output = [`--- a/${relativePath}`, `+++ b/${relativePath}`, "@@"];

  for (let index = contextStart; index < firstChanged; index += 1) {
    output.push(` ${beforeLines[index] ?? ""}`);
  }

  for (let index = firstChanged; index <= lastBeforeChanged; index += 1) {
    output.push(`-${beforeLines[index] ?? ""}`);
  }

  for (let index = firstChanged; index <= lastAfterChanged; index += 1) {
    output.push(`+${afterLines[index] ?? ""}`);
  }

  const contextEnd = Math.min(beforeContextEnd, afterContextEnd);
  for (let index = Math.max(lastBeforeChanged, lastAfterChanged) + 1; index <= contextEnd; index += 1) {
    output.push(` ${beforeLines[index] ?? afterLines[index] ?? ""}`);
  }

  return `${output.join("\n")}\n`;
}

function splitLines(text: string): readonly string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function firstDifferentIndex(
  left: readonly string[],
  right: readonly string[]
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return -1;
}

function lastDifferentIndex(
  left: readonly string[],
  right: readonly string[],
  firstChanged: number
): number {
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;

  while (
    leftIndex >= firstChanged &&
    rightIndex >= firstChanged &&
    left[leftIndex] === right[rightIndex]
  ) {
    leftIndex -= 1;
    rightIndex -= 1;
  }

  return leftIndex;
}
