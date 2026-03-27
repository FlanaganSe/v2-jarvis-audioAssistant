import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary, SessionDetail } from '../types.ts';
import { listSessions, getSessionTurns } from '../api/session.ts';

export function SessionSidebar() {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      listSessions().then(setSessions);
    }
  }, [open]);

  const handleExpand = useCallback(
    async (id: string) => {
      if (expanded === id) {
        setExpanded(null);
        setDetail(null);
        return;
      }
      setExpanded(id);
      const d = await getSessionTurns(id);
      setDetail(d);
    },
    [expanded],
  );

  return (
    <div className="fixed top-0 right-0 z-10">
      <button
        className="m-3 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        onClick={() => setOpen(!open)}
      >
        {open ? 'Close' : 'History'}
      </button>

      {open && (
        <div className="mr-3 max-h-[80vh] w-72 overflow-y-auto rounded-lg bg-gray-900 p-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-300">Past Sessions</h3>
          {sessions.length === 0 && <p className="text-xs text-gray-500">No sessions yet</p>}
          {sessions.map((s) => (
            <div key={s.id} className="mb-2">
              <button
                className="w-full rounded bg-gray-800 p-2 text-left text-xs hover:bg-gray-700"
                onClick={() => handleExpand(s.id)}
              >
                <div className="text-gray-400">
                  {new Date(s.startedAt).toLocaleDateString()}{' '}
                  {new Date(s.startedAt).toLocaleTimeString()}
                </div>
                {s.topics && s.topics.length > 0 && (
                  <div className="mt-1 text-gray-300">{s.topics.join(', ')}</div>
                )}
              </button>

              {expanded === s.id && detail && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded bg-gray-800/50 p-2">
                  {detail.turns.map((t) => (
                    <div
                      key={t.id}
                      className={`mb-1 text-xs ${
                        t.role === 'user' ? 'text-cyan-400' : 'text-gray-400'
                      }`}
                    >
                      <span className="font-semibold">{t.role === 'user' ? 'You' : 'Jarvis'}:</span>{' '}
                      {t.content}
                    </div>
                  ))}
                  {detail.turns.length === 0 && (
                    <p className="text-xs text-gray-600">No turns recorded</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
