import { describe, expect, it, vi } from "vitest";

import {
  ContextError,
  createContextManager,
  estimateContextTokens,
  microcompactToolResults,
  segmentMessages,
  type AgentMessage,
  type ContextSummarizer
} from "../src/index.js";

const longToolContent = Array.from(
  { length: 14 },
  (_, index) => `line ${index + 1} ${"x".repeat(180)}`
).join("\n");

function longToolSegment(id: string): readonly AgentMessage[] {
  return [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id, name: "read_file", input: {} }]
    },
    {
      role: "tool",
      toolCallId: id,
      toolName: "read_file",
      content: longToolContent,
      isError: false
    }
  ];
}

describe("context estimation", () => {
  it("returns a deterministic rough token estimate", () => {
    expect(
      estimateContextTokens({
        messages: [{ role: "user", content: "hello" }],
        tools: []
      })
    ).toBeGreaterThan(0);
  });
});

describe("message segmentation", () => {
  it("keeps assistant tool calls with their following tool results", () => {
    const messages: readonly AgentMessage[] = [
      { role: "user", content: "read" },
      ...longToolSegment("call_1"),
      { role: "assistant", content: "done" }
    ];

    expect(segmentMessages(messages).map(segment => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 4]
    ]);
  });

  it("rejects orphan tool result messages", () => {
    expect(() =>
      segmentMessages([
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "read_file",
          content: "orphan",
          isError: false
        }
      ])
    ).toThrow(ContextError);
  });
});

describe("microcompactToolResults", () => {
  it("compacts old long tool results while preserving recent segments", () => {
    const messages: AgentMessage[] = [];
    for (let index = 0; index < 10; index += 1) {
      messages.push(...longToolSegment(`call_${index}`));
    }

    const result = microcompactToolResults(messages, { keepRecentSegments: 8 });

    expect(result.compactedToolResultCount).toBe(2);
    expect(result.messages[1]?.role).toBe("tool");
    expect(result.messages[1]?.content).toContain("[tool result compacted:");
    expect(result.messages.at(-1)?.content).toBe(longToolContent);
  });

  it("does not compact an already compacted tool result again", () => {
    const compacted = microcompactToolResults(
      [
        ...longToolSegment("call_1"),
        ...longToolSegment("call_2"),
        ...longToolSegment("call_3"),
        ...longToolSegment("call_4"),
        ...longToolSegment("call_5"),
        ...longToolSegment("call_6"),
        ...longToolSegment("call_7"),
        ...longToolSegment("call_8"),
        ...longToolSegment("call_9")
      ],
      { keepRecentSegments: 8 }
    );

    const again = microcompactToolResults(compacted.messages, { keepRecentSegments: 8 });

    expect(again.compactedToolResultCount).toBe(0);
  });
});

describe("createContextManager", () => {
  it("summarizes old segments during manual compaction", async () => {
    const summarize = vi.fn(() => Promise.resolve("Earlier work summary."));
    const summarizer: ContextSummarizer = {
      summarize
    };
    const manager = createContextManager({
      summarizer,
      keepRecentSegments: 1,
      maxEstimatedTokens: 100
    });

    const result = await manager.compact(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "recent" }
      ],
      {}
    );

    expect(summarize).toHaveBeenCalledWith({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" }
      ],
      trigger: "manual"
    });
    expect(result?.messages).toEqual([
      {
        role: "user",
        content: "[Earlier conversation summary]\nEarlier work summary."
      },
      {
        role: "assistant",
        content: "I have the earlier context and will continue the task from it."
      },
      { role: "user", content: "recent" }
    ]);
    expect(result?.compactedSegmentCount).toBe(2);
  });

  it("automatically compacts only after the estimated threshold is reached", async () => {
    const summarizer: ContextSummarizer = {
      summarize: vi.fn(() => Promise.resolve("summary"))
    };
    const manager = createContextManager({
      summarizer,
      keepRecentSegments: 1,
      maxEstimatedTokens: 100,
      autoCompactRatio: 0.5
    });

    await expect(
      manager.compactIfNeeded([{ role: "user", content: "short" }], {})
    ).resolves.toBeUndefined();

    await expect(
      manager.compactIfNeeded(
        [
          { role: "user", content: "old ".repeat(200) },
          { role: "assistant", content: "older" },
          { role: "user", content: "recent" }
        ],
        {}
      )
    ).resolves.toMatchObject({
      trigger: "automatic",
      compactedSegmentCount: 2
    });
  });
});
