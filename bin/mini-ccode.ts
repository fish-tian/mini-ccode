#!/usr/bin/env bun
import { runCli } from "../src/cli/index.js";

process.exitCode = await runCli({
  args: process.argv.slice(2),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr
});

