import type { PollSummary, PollDetail, PollResults, CreatePollPayload } from "./types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }

  return data as T;
}

export function fetchPolls(): Promise<PollSummary[]> {
  return request<PollSummary[]>("/polls");
}

export function fetchPoll(id: string): Promise<PollDetail> {
  return request<PollDetail>(`/polls/${id}`);
}

export function createPoll(payload: CreatePollPayload): Promise<{ id: string }> {
  return request<{ id: string }>("/polls", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitVote(pollId: string, optionId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/polls/${pollId}/vote`, {
    method: "POST",
    body: JSON.stringify({ option_id: optionId }),
  });
}

export function fetchResults(pollId: string): Promise<PollResults> {
  return request<PollResults>(`/polls/${pollId}/results`);
}
