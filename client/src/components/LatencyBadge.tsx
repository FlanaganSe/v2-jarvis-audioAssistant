export function LatencyBadge({ rttMs }: { readonly rttMs: number | null }) {
  if (rttMs === null) return null;

  const color =
    rttMs < 150 ? 'text-green-400' : rttMs < 300 ? 'text-yellow-400' : 'text-red-400';

  return <span className={`text-xs ${color}`}>{rttMs}ms</span>;
}
