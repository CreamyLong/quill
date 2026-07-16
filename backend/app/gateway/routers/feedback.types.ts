/**
 * Feedback API request/response contracts.
 */

export interface FeedbackCreateRequest {
  /** Feedback rating: +1 (positive) or -1 (negative) */
  rating: number;
  /** Optional text feedback */
  comment?: string | null;
  /** Optional: scope feedback to a specific message */
  message_id?: string | null;
}

export type FeedbackUpsertRequest = FeedbackCreateRequest;

export interface FeedbackResponse {
  feedback_id: string;
  run_id: string;
  thread_id: string;
  user_id?: string | null;
  message_id?: string | null;
  rating: number;
  comment?: string | null;
  created_at?: string;
}

export interface FeedbackStatsResponse {
  run_id: string;
  total: number;
  positive: number;
  negative: number;
}
