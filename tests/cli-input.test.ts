import { describe, expect, it } from "vitest";

import { parseCliInput } from "../src/index.js";

describe("parseCliInput", () => {
  it("classifies empty input", () => {
    expect(parseCliInput("   ")).toEqual({ type: "empty" });
  });

  it("classifies exit commands", () => {
    expect(parseCliInput("exit")).toEqual({ type: "exit" });
    expect(parseCliInput("quit")).toEqual({ type: "exit" });
    expect(parseCliInput("/exit")).toEqual({ type: "exit" });
    expect(parseCliInput("/quit")).toEqual({ type: "exit" });
  });

  it("classifies built-in REPL commands", () => {
    expect(parseCliInput("/help")).toEqual({ type: "help" });
    expect(parseCliInput("/compact")).toEqual({ type: "compact" });
    expect(parseCliInput("/reset")).toEqual({ type: "reset" });
    expect(parseCliInput("/save")).toEqual({ type: "save" });
    expect(parseCliInput("/sessions")).toEqual({ type: "sessions" });
  });

  it("classifies regular prompts", () => {
    expect(parseCliInput(" hello there ")).toEqual({
      type: "prompt",
      text: "hello there"
    });
  });
});
