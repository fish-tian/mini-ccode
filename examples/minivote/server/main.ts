import {
  getDb,
  getPolls,
  getPoll,
  createPoll,
  submitVote,
  getResults,
  getVoterToken,
  setVoterCookie,
} from "./db";

const PORT = 3000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const POLL_ID_RE = /^\/api\/polls\/([^/]+)$/;
const VOTE_RE = /^\/api\/polls\/([^/]+)\/vote$/;
const RESULTS_RE = /^\/api\/polls\/([^/]+)\/results$/;

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const voterToken = getVoterToken(req);

  // CORS headers for dev proxy
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── GET /api/polls ────────────────────────────────────────
  if (path === "/api/polls" && method === "GET") {
    const polls = getPolls();
    const res = json(polls);
    Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  // ── POST /api/polls ───────────────────────────────────────
  if (path === "/api/polls" && method === "POST") {
    try {
      const body = await req.json();
      const { title, options } = body;

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return jsonError("请输入投票标题");
      }
      if (!Array.isArray(options) || options.length < 2) {
        return jsonError("至少需要两个选项");
      }
      if (options.some((o) => typeof o !== "string" || o.trim().length === 0)) {
        return jsonError("选项不能为空");
      }
      const trimmedTitle = title.trim();
      const trimmedOptions = options.map((o: string) => o.trim());

      const id = createPoll({ title: trimmedTitle, options: trimmedOptions });
      const res = json({ id }, 201);
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    } catch {
      return jsonError("请求格式错误", 400);
    }
  }

  // ── GET /api/polls/:id/results ─────────────────────────────
  let match = path.match(RESULTS_RE);
  if (match && method === "GET") {
    const pollId = match[1];
    const results = getResults(pollId, voterToken);
    if (!results) {
      return jsonError("请先投票再查看结果", 403);
    }
    const res = json(results);
    Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    res.headers.set("Set-Cookie", setVoterCookie(voterToken));
    return res;
  }

  // ── POST /api/polls/:id/vote ───────────────────────────────
  match = path.match(VOTE_RE);
  if (match && method === "POST") {
    const pollId = match[1];
    try {
      const body = await req.json();
      const { option_id } = body;

      if (!option_id || typeof option_id !== "string") {
        return jsonError("请选择一个选项");
      }

      const result = submitVote(pollId, option_id, voterToken);

      if (!result.success) {
        if (result.alreadyVoted) {
          return jsonError("你已经投过票了", 409);
        }
        return jsonError("投票失败，选项不存在", 400);
      }

      const res = json({ success: true });
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set("Set-Cookie", setVoterCookie(voterToken));
      return res;
    } catch {
      return jsonError("请求格式错误", 400);
    }
  }

  // ── GET /api/polls/:id ────────────────────────────────────
  match = path.match(POLL_ID_RE);
  if (match && method === "GET") {
    const pollId = match[1];
    const poll = getPoll(pollId, voterToken);
    if (!poll) {
      return jsonError("投票不存在", 404);
    }
    const res = json(poll);
    Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    res.headers.set("Set-Cookie", setVoterCookie(voterToken));
    return res;
  }

  return jsonError("Not Found", 404);
}

// ── Start server ──────────────────────────────────────────────────

console.log(`MiniVote API server starting on http://localhost:${PORT}`);

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

// Ensure DB is initialized on startup
getDb();
console.log("Database ready.");
