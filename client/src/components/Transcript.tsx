import { useEffect, useRef } from 'react';
import type { TranscriptEntry } from '../hooks/useSession.ts';

interface TranscriptProps {
  readonly entries: readonly TranscriptEntry[];
}

export function Transcript({ entries }: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="mx-auto max-h-64 w-full max-w-xl overflow-y-auto rounded-lg bg-gray-900 p-4"
    >
      {entries.map((entry, i) =>
        entry.role === 'tool' ? (
          <div key={i} className="mb-2 text-sm italic text-gray-500">
            {entry.text}
          </div>
        ) : (
          <div
            key={i}
            className={`mb-2 text-sm ${
              entry.role === 'user' ? 'text-cyan-400' : 'text-gray-300'
            } ${!entry.final ? 'opacity-70' : ''}`}
          >
            <span className="mr-2 font-semibold">
              {entry.role === 'user' ? 'You' : 'Jarvis'}:
            </span>
            {entry.text}
          </div>
        ),
      )}
    </div>
  );
}
