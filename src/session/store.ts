import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentMessage } from "../agent/index.js";
import {
  SessionStoreError,
  type SavedSession,
  type SessionId,
  type SessionStore,
  type SessionStoreOptions,
  type SessionSummary
} from "./types.js";

const sessionFileVersion = 1;
const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDefaultSessionStore(workspaceRoot: string): SessionStore {
  return createSessionStore({
    storageRoot: path.join(homedir(), ".mini-ccode"),
    workspaceRoot
  });
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const sessionsDirectory = path.join(
    path.resolve(options.storageRoot),
    "projects",
    workspaceKey(workspaceRoot),
    "sessions"
  );
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;

  return {
    async save(messages, sessionId) {
      const id = validatedSessionId(sessionId ?? createId());
      const savedSession: SavedSession = {
        version: sessionFileVersion,
        id,
        workspaceRoot,
        savedAt: now().toISOString(),
        messages: messages.map(cloneMessage)
      };

      try {
        await mkdir(sessionsDirectory, { recursive: true });
        await writeFile(sessionPath(sessionsDirectory, id), JSON.stringify(savedSession, null, 2), "utf8");
      } catch (error) {
        throw storageError(`Unable to save session "${id}".`, error);
      }

      return summaryFromSession(savedSession);
    },

    async load(sessionId) {
      const id = validatedSessionId(sessionId);
      let contents: string;

      try {
        contents = await readFile(sessionPath(sessionsDirectory, id), "utf8");
      } catch (error) {
        if (isNodeError(error, "ENOENT")) {
          return undefined;
        }

        throw storageError(`Unable to load session "${id}".`, error);
      }

      return parseSession(contents, id, workspaceRoot);
    },

    async list() {
      let entries: string[];

      try {
        entries = await readdir(sessionsDirectory);
      } catch (error) {
        if (isNodeError(error, "ENOENT")) {
          return [];
        }

        throw storageError("Unable to list sessions.", error);
      }

      const sessions: SessionSummary[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) {
          continue;
        }

        const id = entry.slice(0, -".json".length);
        if (!sessionIdPattern.test(id)) {
          continue;
        }

        try {
          const session = await this.load(id);
          if (session !== undefined) {
            sessions.push(summaryFromSession(session));
          }
        } catch (error) {
          if (
            error instanceof SessionStoreError &&
            (error.code === "invalid_session_file" || error.code === "workspace_mismatch")
          ) {
            continue;
          }

          throw error;
        }
      }

      return sessions.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    }
  };
}

function workspaceKey(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
}

function validatedSessionId(sessionId: string): SessionId {
  if (!sessionIdPattern.test(sessionId)) {
    throw new SessionStoreError(
      "invalid_session_id",
      `Invalid session id "${sessionId}". Expected a UUID.`
    );
  }

  return sessionId;
}

function sessionPath(directory: string, sessionId: SessionId): string {
  return path.join(directory, `${sessionId}.json`);
}

function parseSession(contents: string, id: SessionId, workspaceRoot: string): SavedSession {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw invalidSessionFile(id);
  }

  if (!isSavedSession(parsed) || parsed.id !== id) {
    throw invalidSessionFile(id);
  }

  if (path.resolve(parsed.workspaceRoot) !== workspaceRoot) {
    throw new SessionStoreError(
      "workspace_mismatch",
      `Session "${id}" belongs to a different workspace.`
    );
  }

  return {
    ...parsed,
    messages: parsed.messages.map(cloneMessage)
  };
}

function isSavedSession(value: unknown): value is SavedSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === sessionFileVersion &&
    typeof value.id === "string" &&
    sessionIdPattern.test(value.id) &&
    typeof value.workspaceRoot === "string" &&
    typeof value.savedAt === "string" &&
    !Number.isNaN(Date.parse(value.savedAt)) &&
    Array.isArray(value.messages) &&
    value.messages.every(isAgentMessage)
  );
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.content !== "string") {
    return false;
  }

  if (value.role === "user") {
    return true;
  }

  if (value.role === "tool") {
    return (
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      typeof value.isError === "boolean"
    );
  }

  if (value.role !== "assistant") {
    return false;
  }

  return value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) && value.toolCalls.every(isToolCall));
}

function isToolCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isRecord(value.input)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneMessage(message: AgentMessage): AgentMessage {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return {
      ...message,
      toolCalls: message.toolCalls.map(call => ({ ...call, input: { ...call.input } }))
    };
  }

  return { ...message };
}

function summaryFromSession(session: SavedSession): SessionSummary {
  const firstUserMessage = session.messages.find(message => message.role === "user");
  return {
    id: session.id,
    savedAt: session.savedAt,
    preview: firstUserMessage?.content.replace(/\s+/g, " ").trim().slice(0, 80) ?? "",
    messageCount: session.messages.length
  };
}

function invalidSessionFile(id: SessionId): SessionStoreError {
  return new SessionStoreError(
    "invalid_session_file",
    `Session "${id}" could not be loaded because its saved data is invalid.`
  );
}

function storageError(message: string, error: unknown): SessionStoreError {
  const detail = error instanceof Error ? ` ${error.message}` : "";
  return new SessionStoreError("storage_error", `${message}${detail}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
