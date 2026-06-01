import { Database } from "bun:sqlite";

const DB_PATH = "minivote.db";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS options (
      id       TEXT PRIMARY KEY,
      poll_id  TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text     TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS votes (
      id          TEXT PRIMARY KEY,
      poll_id     TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_id   TEXT NOT NULL REFERENCES options(id) ON DELETE CASCADE,
      voter_token TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(poll_id, voter_token)
    );
  `);
}

// ── Types ──────────────────────────────────────────────────────

export interface PollRow {
  id: string;
  title: string;
  created_at: string;
  option_count: number;
  vote_count: number;
}

export interface OptionRow {
  id: string;
  text: string;
  position: number;
}

export interface PollDetail {
  id: string;
  title: string;
  created_at: string;
  options: OptionRow[];
  hasVoted: boolean;
  totalVotes: number;
}

export interface ResultRow {
  id: string;
  text: string;
  count: number;
  percent: number;
}

export interface PollResults {
  pollTitle: string;
  options: ResultRow[];
  totalVotes: number;
}

export interface CreatePollInput {
  title: string;
  options: string[];
}

// ── Queries ────────────────────────────────────────────────────

export function getPolls(): PollRow[] {
  const d = getDb();
  const rows = d
    .query(
      `SELECT p.id, p.title, p.created_at,
              COUNT(DISTINCT o.id) AS option_count,
              COUNT(DISTINCT v.id) AS vote_count
       FROM polls p
       LEFT JOIN options o ON o.poll_id = p.id
       LEFT JOIN votes v ON v.poll_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    )
    .all() as PollRow[];
  return rows;
}

export function getPoll(pollId: string, voterToken: string): PollDetail | null {
  const d = getDb();
  const poll = d
    .query(`SELECT id, title, created_at FROM polls WHERE id = ?`)
    .get(pollId) as { id: string; title: string; created_at: string } | null;

  if (!poll) return null;

  const options = d
    .query(`SELECT id, text, position FROM options WHERE poll_id = ? ORDER BY position`)
    .all(pollId) as OptionRow[];

  const hasVoted = !!d
    .query(`SELECT 1 FROM votes WHERE poll_id = ? AND voter_token = ?`)
    .get(pollId, voterToken);

  const totalVotes = (
    d.query(`SELECT COUNT(*) as c FROM votes WHERE poll_id = ?`).get(pollId) as { c: number }
  ).c;

  return { ...poll, options, hasVoted, totalVotes };
}

export function createPoll(input: CreatePollInput): string {
  const d = getDb();
  const pollId = crypto.randomUUID();

  d.transaction(() => {
    d.query(`INSERT INTO polls (id, title) VALUES (?, ?)`).run(pollId, input.title);
    for (let i = 0; i < input.options.length; i++) {
      const optId = crypto.randomUUID();
      d.query(`INSERT INTO options (id, poll_id, text, position) VALUES (?, ?, ?, ?)`).run(
        optId,
        pollId,
        input.options[i],
        i
      );
    }
  })();

  return pollId;
}

export function submitVote(
  pollId: string,
  optionId: string,
  voterToken: string
): { success: true; alreadyVoted: false } | { success: false; alreadyVoted: boolean } {
  const d = getDb();

  const existing = d
    .query(`SELECT 1 FROM votes WHERE poll_id = ? AND voter_token = ?`)
    .get(pollId, voterToken);

  if (existing) {
    return { success: false, alreadyVoted: true };
  }

  const optionExists = d
    .query(`SELECT 1 FROM options WHERE id = ? AND poll_id = ?`)
    .get(optionId, pollId);

  if (!optionExists) {
    return { success: false, alreadyVoted: false };
  }

  d.query(`INSERT INTO votes (id, poll_id, option_id, voter_token) VALUES (?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    pollId,
    optionId,
    voterToken
  );

  return { success: true, alreadyVoted: false };
}

export function getResults(pollId: string, voterToken: string): PollResults | null {
  const d = getDb();

  const poll = d
    .query(`SELECT id, title FROM polls WHERE id = ?`)
    .get(pollId) as { id: string; title: string } | null;

  if (!poll) return null;

  const hasVoted = !!d
    .query(`SELECT 1 FROM votes WHERE poll_id = ? AND voter_token = ?`)
    .get(pollId, voterToken);

  if (!hasVoted) return null;

  const totalVotes = (
    d.query(`SELECT COUNT(*) as c FROM votes WHERE poll_id = ?`).get(pollId) as { c: number }
  ).c;

  const rows = d
    .query(
      `SELECT o.id, o.text, COUNT(v.id) AS count
       FROM options o
       LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.poll_id = ?
       GROUP BY o.id
       ORDER BY o.position`
    )
    .all(pollId) as { id: string; text: string; count: number }[];

  const options: ResultRow[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    count: r.count,
    percent: totalVotes > 0 ? Math.round((r.count / totalVotes) * 100) : 0,
  }));

  return { pollTitle: poll.title, options, totalVotes };
}

// ── Voter token management ─────────────────────────────────────

const VOTER_COOKIE = "voter_id";

export function getVoterToken(request: Request): string {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${VOTER_COOKIE}=([^;]+)`));
  if (match) return match[1];
  return crypto.randomUUID();
}

export function setVoterCookie(token: string): string {
  // HttpOnly + SameSite=Lax + path=/ + max-age 365 days
  return `${VOTER_COOKIE}=${token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
}
