import { useEffect, useRef } from 'react';
import type { VoiceState } from '../types.ts';
import { useAnalyser } from '../hooks/useAnalyser.ts';

interface OrbProps {
  readonly state: VoiceState;
  readonly micStream: MediaStream | null;
  readonly remoteStream: MediaStream | null;
}

const stateToDataState = (state: VoiceState): string => {
  switch (state) {
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    case 'working':
    case 'processing':
      return 'working';
    default:
      return 'idle';
  }
};

export function Orb({ state, micStream, remoteStream }: OrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const micAmplitude = useAnalyser(micStream);
  const remoteAmplitude = useAnalyser(remoteStream);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const animate = (): void => {
      if (orbRef.current) {
        const amp =
          state === 'listening'
            ? micAmplitude.current
            : state === 'speaking'
              ? remoteAmplitude.current
              : 0;
        orbRef.current.style.setProperty('--amplitude', String(amp));
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, micAmplitude, remoteAmplitude]);

  return (
    <div ref={orbRef} className="orb" data-state={stateToDataState(state)}>
      <div className="orb__core" />
    </div>
  );
}
