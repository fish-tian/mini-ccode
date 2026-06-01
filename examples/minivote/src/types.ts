export interface PollSummary {
  id: string;
  title: string;
  created_at: string;
  option_count: number;
  vote_count: number;
}

export interface PollDetail {
  id: string;
  title: string;
  created_at: string;
  options: Option[];
  hasVoted: boolean;
  totalVotes: number;
}

export interface Option {
  id: string;
  text: string;
  position: number;
}

export interface ResultOption {
  id: string;
  text: string;
  count: number;
  percent: number;
}

export interface PollResults {
  pollTitle: string;
  options: ResultOption[];
  totalVotes: number;
}

export interface CreatePollPayload {
  title: string;
  options: string[];
}
