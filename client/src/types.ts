export type VoiceState =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'working'
  | 'speaking'
  | 'error';

export interface Turn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly topics: string[] | null;
}

export interface SessionSummaryData {
  readonly topics: string[] | null;
  readonly keyFacts: string[] | null;
  readonly unresolved: string[] | null;
}

export interface RepoDigest {
  readonly name: string;
  readonly description: string | null;
  readonly language: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly topics: readonly string[];
}

export interface IssueDigest {
  readonly title: string;
  readonly state: string;
  readonly author: string | null;
  readonly commentCount: number;
  readonly labels: readonly string[];
}

export interface PullDigest {
  readonly title: string;
  readonly state: string;
  readonly merged: boolean;
  readonly author: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly reviewCommentCount: number;
}

export interface FileDigest {
  readonly path: string;
  readonly size: number;
}

export type GitHubDigest =
  | { readonly type: 'repo'; readonly data: RepoDigest; readonly sourceUrl: string | null }
  | { readonly type: 'issue'; readonly data: IssueDigest; readonly sourceUrl: string | null }
  | { readonly type: 'pull'; readonly data: PullDigest; readonly sourceUrl: string | null }
  | { readonly type: 'file'; readonly data: FileDigest; readonly sourceUrl: string | null };

export interface SessionDetail {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly turns: readonly Turn[];
  readonly summary: SessionSummaryData | null;
}
