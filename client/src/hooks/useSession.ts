import { useCallback, useRef, useState } from 'react';
import type { VoiceState } from '../types.ts';
import type { VadMode } from '../components/VadToggle.tsx';
import { createSession, connectSideband } from '../api/session.ts';

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly final: boolean;
}

export interface UseSessionReturn {
  readonly state: VoiceState;
  readonly transcript: readonly TranscriptEntry[];
  readonly vadMode: VadMode;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly startTalking: () => void;
  readonly stopTalking: () => void;
  readonly setVadMode: (mode: VadMode) => void;
  readonly micStream: MediaStream | null;
  readonly remoteStream: MediaStream | null;
}

export function useSession(): UseSessionReturn {
  const [state, setState] = useState<VoiceState>('disconnected');
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [vadMode, setVadModeState] = useState<VadMode>('ptt');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef(false);
  const cancelledRef = useRef(false);
  const vadModeRef = useRef<VadMode>('ptt');

  const appendTranscript = useCallback((delta: string, role: 'user' | 'assistant') => {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.final) {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [...prev, { role, text: delta, final: false }];
    });
  }, []);

  const finalizeTranscript = useCallback(() => {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && !last.final) {
        return [...prev.slice(0, -1), { ...last, final: true }];
      }
      return prev;
    });
  }, []);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (micTrackRef.current) {
      micTrackRef.current.stop();
      micTrackRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    dcRef.current = null;
    isSpeakingRef.current = false;
    setMicStream(null);
    setRemoteStream(null);
  }, []);

  const handleServerEvent = useCallback(
    (event: {
      type: string;
      delta?: string;
      transcript?: string;
      session?: { turn_detection?: unknown };
    }) => {
      switch (event.type) {
        case 'response.output_audio_transcript.delta':
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            setState('speaking');
            audioElRef.current?.play().catch((err: unknown) => {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              console.warn('Audio play failed:', err);
            });
          }
          if (event.delta) appendTranscript(event.delta, 'assistant');
          break;

        case 'response.output_audio_transcript.done':
          finalizeTranscript();
          break;

        case 'response.function_call_arguments.done':
          setState('working');
          break;

        case 'response.done':
        case 'response.cancelled':
          isSpeakingRef.current = false;
          setState('ready');
          break;

        case 'input_audio_buffer.speech_started':
          audioElRef.current?.pause();
          if (isSpeakingRef.current) {
            isSpeakingRef.current = false;
            finalizeTranscript();
          }
          setState('listening');
          break;

        case 'session.updated':
          console.log('[VAD] session.updated turn_detection:', event.session?.turn_detection);
          break;

        case 'input_audio_buffer.speech_stopped':
          if (vadModeRef.current === 'vad') {
            finalizeTranscript();
            setState('processing');
          }
          break;

        case 'error':
          console.error('Realtime error:', event);
          break;
      }
    },
    [appendTranscript, finalizeTranscript],
  );

  const connect = useCallback(async () => {
    cleanup();
    cancelledRef.current = false;
    setState('connecting');
    setTranscript([]);

    try {
      const { ephemeralKey } = await createSession();
      if (cancelledRef.current) return;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Audio element for remote playback
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        setRemoteStream(e.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setState('disconnected');
          cleanup();
        }
      };

      // Mic track (starts muted)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      micTrackRef.current = track;
      setMicStream(stream);
      pc.addTrack(track, stream);

      // Data channel
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.addEventListener('message', (e) => {
        try {
          handleServerEvent(JSON.parse(e.data as string));
        } catch {
          // ignore unparseable
        }
      });

      dc.addEventListener('open', () => {
        if (cancelledRef.current) return;
        setState('ready');
        if (vadModeRef.current === 'vad') {
          dc.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: 'auto',
                  interrupt_response: true,
                  create_response: true,
                },
              },
            }),
          );
          if (micTrackRef.current) micTrackRef.current.enabled = true;
        }
      });

      dc.addEventListener('close', () => {
        setState('disconnected');
      });

      // SDP exchange
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed: ${sdpRes.status}`);
      }

      const callId = sdpRes.headers.get('Location')?.split('/').pop() ?? null;
      const answerSdp = await sdpRes.text();

      if (cancelledRef.current) return;

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // Connect sideband for server-side tool execution
      if (callId) {
        connectSideband(callId, ephemeralKey).catch(() => {
          console.warn('Sideband failed — tools will not work');
        });
      }
    } catch (err) {
      console.error('Connection failed:', err);
      setState('error');
      cleanup();
    }
  }, [cleanup, handleServerEvent]);

  const disconnect = useCallback(() => {
    cancelledRef.current = true;
    cleanup();
    setState('disconnected');
  }, [cleanup]);

  const startTalking = useCallback(() => {
    const dc = dcRef.current;
    const track = micTrackRef.current;
    if (!dc || dc.readyState !== 'open' || !track) return;

    // Clear stale audio from prior turn
    dc.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));

    // Interrupt if speaking
    if (isSpeakingRef.current) {
      dc.send(JSON.stringify({ type: 'response.cancel' }));
      dc.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
      isSpeakingRef.current = false;
      finalizeTranscript();
    }

    track.enabled = true;
    setState('listening');
    appendTranscript('[speaking] ', 'user');
  }, [appendTranscript, finalizeTranscript]);

  const stopTalking = useCallback(() => {
    const dc = dcRef.current;
    const track = micTrackRef.current;
    if (!track) return;

    track.enabled = false;

    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    }

    finalizeTranscript();
    setState('processing');
  }, [finalizeTranscript]);

  const setVadMode = useCallback((mode: VadMode) => {
    setVadModeState(mode);
    vadModeRef.current = mode;
    const dc = dcRef.current;
    const track = micTrackRef.current;
    if (!dc || dc.readyState !== 'open') return;

    if (mode === 'vad') {
      // Enable VAD: turn on mic, send session.update with semantic_vad
      dc.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'auto',
              interrupt_response: true,
              create_response: true,
            },
          },
        }),
      );
      if (track) track.enabled = true;
    } else {
      // Disable VAD: turn off mic, send session.update with null turn_detection
      dc.send(
        JSON.stringify({
          type: 'session.update',
          session: { turn_detection: null },
        }),
      );
      if (track) track.enabled = false;
    }
  }, []);

  return {
    state,
    transcript,
    vadMode,
    connect,
    disconnect,
    startTalking,
    stopTalking,
    setVadMode,
    micStream,
    remoteStream,
  };
}
