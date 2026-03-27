import type { VoiceState } from '../types.ts';

const labels: Record<VoiceState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  ready: 'Ready',
  listening: 'Listening...',
  processing: 'Processing...',
  working: 'Working...',
  speaking: 'Speaking...',
  error: 'Error',
};

const colors: Record<VoiceState, string> = {
  disconnected: 'bg-gray-600',
  connecting: 'bg-yellow-600',
  ready: 'bg-green-600',
  listening: 'bg-cyan-600',
  processing: 'bg-purple-600',
  working: 'bg-purple-600',
  speaking: 'bg-cyan-500',
  error: 'bg-red-600',
};

export function StatusBadge({ state }: { readonly state: VoiceState }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium text-white ${colors[state]}`}
    >
      {labels[state]}
    </span>
  );
}
