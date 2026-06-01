import type { AgentMessage } from "../agent/index.js";

export type SessionId = string;

export type SavedSession = {
  readonly version: 1;
  readonly id: SessionId;
  readonly workspaceRoot: string;
  readonly savedAt: string;
  readonly messages: readonly AgentMessage[];
};

export type SessionSummary = {
  readonly id: SessionId;
  readonly savedAt: string;
  readonly preview: string;
  readonly messageCount: number;
};

export type SessionStoreOptions = {
  readonly storageRoot: string;
  readonly workspaceRoot: string;
  readonly now?: () => Date;
  readonly createId?: () => string;
};

export type SessionStoreErrorCode =
  | "invalid_session_id"
  | "invalid_session_file"
  | "workspace_mismatch"
  | "storage_error";

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;

  constructor(code: SessionStoreErrorCode, message: string) {
    super(message);
    this.name = "SessionStoreError";
    this.code = code;
  }
}

export interface SessionStore {
  save(messages: readonly AgentMessage[], sessionId?: SessionId): Promise<SessionSummary>;
  load(sessionId: SessionId): Promise<SavedSession | undefined>;
  list(): Promise<readonly SessionSummary[]>;
}
