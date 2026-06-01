import { createInterface } from "node:readline/promises";

export type CliInputReader = {
  readonly question: (prompt: string) => Promise<string | undefined>;
  readonly close: () => void;
};

export function createCliInputReader(options: {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream & { readonly isTTY?: boolean };
  readonly lineSource?: AsyncIterable<string> | Iterable<string>;
}): CliInputReader {
  if (options.lineSource !== undefined) {
    const iterator = toAsyncIterator(options.lineSource);
    return {
      question: async () => {
        const next = await iterator.next();
        return next.done ? undefined : next.value;
      },
      close: () => undefined
    };
  }

  const readline = createInterface({
    input: options.stdin,
    output: options.stdout,
    terminal: options.stdout.isTTY
  });

  return {
    question: async prompt => {
      try {
        return await readline.question(prompt);
      } catch (error) {
        if (isReadlineClose(error)) {
          return undefined;
        }
        throw error;
      }
    },
    close: () => {
      readline.close();
    }
  };
}

function toAsyncIterator(
  source: AsyncIterable<string> | Iterable<string>
): AsyncIterator<string> {
  if (Symbol.asyncIterator in source) {
    return source[Symbol.asyncIterator]();
  }

  const iterator = source[Symbol.iterator]();
  return {
    next: () => Promise.resolve(iterator.next())
  };
}

function isReadlineClose(error: unknown): boolean {
  return error instanceof Error && error.message === "readline was closed";
}
