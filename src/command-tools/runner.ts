import { spawn } from "node:child_process";

import type { CommandRunRequest, CommandRunResult } from "./types.js";

export function runCommand(request: CommandRunRequest): Promise<CommandRunResult> {
  const executable = request.shell === "powershell" ? "powershell.exe" : "bash";
  const args =
    request.shell === "powershell"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", request.command]
      : ["--noprofile", "--norc", "-lc", request.command];

  return new Promise<CommandRunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd: request.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, request.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", error => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ kind: "timeout", timeoutMs: request.timeoutMs });
        return;
      }
      reject(error);
    });

    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ kind: "timeout", timeoutMs: request.timeoutMs });
        return;
      }
      resolve({
        kind: "completed",
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });
  });
}
