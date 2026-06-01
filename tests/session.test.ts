import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  SessionStoreError,
  type AgentMessage,
  type SessionStore
} from "../src/index.js";

const firstId = "550e8400-e29b-41d4-a716-446655440000";
const secondId = "550e8400-e29b-41d4-a716-446655440001";

let storageRoot: string;
let store: SessionStore;
let idIndex: number;
let timeIndex: number;

beforeEach(async () => {
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ccode-session-"));
  idIndex = 0;
  timeIndex = 0;
  store = createSessionStore({
    storageRoot,
    workspaceRoot: "C:\\workspace\\mini-ccode",
    createId: () => [firstId, secondId][idIndex++] ?? secondId,
    now: () =>
      new Date(
        [
          "2026-05-26T08:00:00.000Z",
          "2026-05-26T09:00:00.000Z",
          "2026-05-26T10:00:00.000Z"
        ][timeIndex++]!
      )
  });
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

describe("createSessionStore", () => {
  it("saves and loads complete message snapshots including tool results", async () => {
    const messages: readonly AgentMessage[] = [
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", input: { file_path: "README.md" } }]
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "read_file",
        content: "contents",
        isError: false
      }
    ];

    await expect(store.save(messages)).resolves.toEqual({
      id: firstId,
      savedAt: "2026-05-26T08:00:00.000Z",
      preview: "read file",
      messageCount: 3
    });

    await expect(store.load(firstId)).resolves.toEqual({
      version: 1,
      id: firstId,
      workspaceRoot: path.resolve("C:\\workspace\\mini-ccode"),
      savedAt: "2026-05-26T08:00:00.000Z",
      messages
    });
  });

  it("updates an existing session id and lists newest snapshots first", async () => {
    await store.save([{ role: "user", content: "  first\nprompt  " }], firstId);
    await store.save([{ role: "user", content: "updated prompt" }], firstId);
    await store.save([{ role: "user", content: "second prompt" }], secondId);

    const sessions = await store.list();

    expect(sessions).toEqual([
      {
        id: secondId,
        savedAt: "2026-05-26T10:00:00.000Z",
        preview: "second prompt",
        messageCount: 1
      },
      {
        id: firstId,
        savedAt: "2026-05-26T09:00:00.000Z",
        preview: "updated prompt",
        messageCount: 1
      }
    ]);

    const projects = await readdir(path.join(storageRoot, "projects"));
    const files = await readdir(path.join(storageRoot, "projects", projects[0]!, "sessions"));
    expect(files.sort()).toEqual([`${firstId}.json`, `${secondId}.json`]);
  });

  it("returns undefined for missing sessions and rejects invalid ids", async () => {
    await expect(store.load(firstId)).resolves.toBeUndefined();
    await expect(store.load("../outside")).rejects.toMatchObject({
      code: "invalid_session_id"
    });
  });

  it("rejects damaged session data and skips it when listing", async () => {
    await store.save([{ role: "user", content: "valid" }], firstId);
    const projects = await readdir(path.join(storageRoot, "projects"));
    const sessionsDir = path.join(storageRoot, "projects", projects[0]!, "sessions");
    await writeFile(path.join(sessionsDir, `${secondId}.json`), "{broken", "utf8");

    await expect(store.load(secondId)).rejects.toBeInstanceOf(SessionStoreError);
    await expect(store.list()).resolves.toEqual([
      {
        id: firstId,
        savedAt: "2026-05-26T08:00:00.000Z",
        preview: "valid",
        messageCount: 1
      }
    ]);

    const savedText = await readFile(path.join(sessionsDir, `${firstId}.json`), "utf8");
    expect(savedText).toContain('"version": 1');
  });

  it("rejects a session snapshot that names another workspace", async () => {
    await store.save([{ role: "user", content: "valid" }], firstId);
    const projects = await readdir(path.join(storageRoot, "projects"));
    const sessionFile = path.join(
      storageRoot,
      "projects",
      projects[0]!,
      "sessions",
      `${firstId}.json`
    );
    const contents = JSON.parse(await readFile(sessionFile, "utf8")) as Record<string, unknown>;
    contents.workspaceRoot = path.resolve("C:\\workspace\\another-project");
    await writeFile(sessionFile, JSON.stringify(contents), "utf8");

    await expect(store.load(firstId)).rejects.toMatchObject({
      code: "workspace_mismatch"
    });
  });
});
