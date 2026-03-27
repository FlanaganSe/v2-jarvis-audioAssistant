import { useEffect, useRef } from 'react';

export function useAnalyser(stream: MediaStream | null): React.RefObject<number> {
  const amplitudeRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      amplitudeRef.current = 0;
      return;
    }

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    // Tap only — never connect analyser to ctx.destination (breaks AEC)

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = (): void => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      amplitudeRef.current = Math.min(1, Math.pow(Math.sqrt(sum / data.length) / 255, 0.4));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      ctx.close();
    };
  }, [stream]);

  return amplitudeRef;
}
