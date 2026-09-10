/**
 * Client for the Take 5 service (`take5/src/server.ts`).
 *
 * Vite proxies `/take5-api` to the local service, so the dashboard never needs
 * to know the port and the service can stay bound to loopback.
 */

const BASE = '/take5-api';

export interface Status {
  dryRun: boolean;
  minConfidence: number;
  cron: string;
  timezone: string;
  inbox: number;
  issues: number;
  entries: number;
}

export interface IssueSummary {
  id: string;
  title: string;
  importedAt: string;
  puzzles: number;
  warnings: number;
}

export interface Puzzle {
  id: string;
  page: number;
  kind: string;
  title: string;
  prize?: string;
  closesAt?: string;
  warnings: string[];
  entry?: { formId: string; answerFrom: string; keywordCells?: { r: number; c: number }[] };
}

export interface Solution {
  puzzleId: string;
  solved: boolean;
  confidence: number;
  answer: string | null;
  notes: string[];
  solvedAt: string;
}

export interface Receipt {
  puzzleId: string;
  issueId: string;
  status: 'submitted' | 'dry-run' | 'failed' | 'skipped';
  answer: string | null;
  at: string;
  message?: string;
  screenshots: string[];
}

export interface IssueDetail {
  issue: { id: string; title: string; importedAt: string; puzzles: Puzzle[] };
  solutions: Solution[];
  receipts: Receipt[];
}

export class ServiceOffline extends Error {
  constructor() {
    super('The Take 5 service is not running. Start it with `cd take5 && npm run serve`.');
    this.name = 'ServiceOffline';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ServiceOffline();
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error ?? `request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<Status>('/api/status'),
  issues: () => request<IssueSummary[]>('/api/issues'),
  issue: (id: string) => request<IssueDetail>(`/api/issues/${encodeURIComponent(id)}`),
  solve: (id: string) =>
    request<{ solutions: Solution[] }>(`/api/issues/${encodeURIComponent(id)}/solve`, { method: 'POST' }),
  submit: (id: string, live: boolean) =>
    request<{ receipts: Receipt[] }>(`/api/issues/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ live }),
    }),
  ledger: () => request<Receipt[]>('/api/ledger'),
};
