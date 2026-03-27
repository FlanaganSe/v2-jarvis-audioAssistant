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

export interface SessionDetail {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly turns: readonly Turn[];
}
