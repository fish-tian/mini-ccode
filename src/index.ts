export type ModuleStatus = "todo" | "in-progress" | "review" | "done";

export type ModuleDescriptor = {
  readonly name: string;
  readonly status: ModuleStatus;
};

export const projectName = "mini-ccode";

export const scaffoldModules: readonly ModuleDescriptor[] = [
  { name: "Project Skeleton", status: "done" },
  { name: "LLM Provider", status: "done" },
  { name: "Agent Loop", status: "done" },
  { name: "CLI / REPL", status: "done" },
  { name: "Tool System", status: "done" },
  { name: "Permission", status: "done" },
  { name: "File Tools", status: "done" },
  { name: "CLI Permission Mode", status: "done" },
  { name: "Session", status: "done" },
  { name: "Interactive Permission Approval", status: "done" },
  { name: "Bash", status: "done" },
  { name: "Context", status: "done" },
  { name: "System Prompt / Instructions", status: "done" },
  { name: "Todo", status: "done" },
  { name: "Sub-Agent", status: "done" },
  { name: "Hooks", status: "todo" },
  { name: "Skills / Plugin", status: "todo" }
] as const;

export * from "./agent/index.js";
export * from "./cli/index.js";
export * from "./command-tools/index.js";
export * from "./context/index.js";
export * from "./file-tools/index.js";
export * from "./instructions/index.js";
export * from "./llm/index.js";
export * from "./permission/index.js";
export * from "./session/index.js";
export * from "./sub-agent/index.js";
export * from "./todo/index.js";
export * from "./tools/index.js";
