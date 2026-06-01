import { describe, expect, it } from "vitest";

import { projectName, scaffoldModules } from "../src/index.js";

describe("project scaffold", () => {
  it("exposes the project name", () => {
    expect(projectName).toBe("mini-ccode");
  });

  it("tracks placeholder modules without implementing agent behavior", () => {
    expect(scaffoldModules.map((module) => module.name)).toContain("Agent Loop");
    expect(scaffoldModules.every((module) => module.status.length > 0)).toBe(true);
  });
});
