export type VadMode = 'ptt' | 'vad';

interface VadToggleProps {
  readonly mode: VadMode;
  readonly disabled: boolean;
  readonly onChange: (mode: VadMode) => void;
}

export function VadToggle({ mode, disabled, onChange }: VadToggleProps) {
  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs ${mode === 'ptt' ? 'text-cyan-400' : 'text-gray-500'}`}>PTT</span>
      <button
        className="relative h-6 w-11 rounded-full bg-gray-700 transition-colors disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChange(mode === 'ptt' ? 'vad' : 'ptt')}
        aria-label={`Switch to ${mode === 'ptt' ? 'hands-free' : 'push-to-talk'} mode`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-cyan-400 transition-transform ${
            mode === 'vad' ? 'translate-x-5' : ''
          }`}
        />
      </button>
      <span className={`text-xs ${mode === 'vad' ? 'text-cyan-400' : 'text-gray-500'}`}>VAD</span>
    </div>
  );
}
