import { useCallback, useEffect } from 'react';

interface PttButtonProps {
  readonly disabled: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
}

export function PttButton({ disabled, onStart, onStop }: PttButtonProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !disabled) {
        e.preventDefault();
        onStart();
      }
    },
    [disabled, onStart],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        onStop();
      }
    },
    [onStop],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return (
    <button
      className="rounded-full bg-gray-800 px-8 py-4 text-lg font-medium text-gray-100 transition-colors hover:bg-gray-700 active:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        if (!disabled) onStart();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onStop();
      }}
      onPointerLeave={() => onStop()}
    >
      Hold to Talk
    </button>
  );
}
