import type { SessionSummary, SessionDetail } from '../types.ts';

export const createSession = async (): Promise<{ ephemeralKey: string }> => {
  const res = await fetch('/api/session', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? 'Failed to create session');
  }
  return res.json() as Promise<{ ephemeralKey: string }>;
};

export const connectSideband = async (callId: string): Promise<void> => {
  const res = await fetch('/api/session/sideband', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId }),
  });
  if (!res.ok) {
    console.warn('Sideband connection failed — tools will not work');
  }
};

export const listSessions = async (): Promise<readonly SessionSummary[]> => {
  const res = await fetch('/api/sessions');
  if (!res.ok) return [];
  return res.json() as Promise<SessionSummary[]>;
};

export const getSessionTurns = async (id: string): Promise<SessionDetail | null> => {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/turns`);
  if (!res.ok) return null;
  return res.json() as Promise<SessionDetail>;
};
