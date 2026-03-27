import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceState, GitHubDigest } from '../types.ts';
import type { VadMode } from '../components/VadToggle.tsx';
import { createSession, connectSideband } from '../api/session.ts';

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
  readonly final: boolean;
  readonly toolName?: string;
}

const parseGitHubDigest = (output: string): GitHubDigest | null => {
  try {
    const raw = JSON.parse(output) as Record<string, unknown>;
    const evidence = raw.evidence as Record<string, unknown> | undefined;
    const sourceType = evidence?.sourceType as string | undefined;
    const sourceUrl = (evidence?.sourceUrl as string) ?? null;

    if (typeof raw.error === 'string') return null;

    switch (sourceType) {
      case 'github_repo':
        return {
          type: 'repo',
          sourceUrl,
          data: {
            name: String(raw.name ?? ''),
            description: typeof raw.description === 'string' ? raw.description : null,
            language: typeof raw.language === 'string' ? raw.language : null,
            stars: Number(raw.stars ?? 0),
            forks: Number(raw.forks ?? 0),
            openIssues: Number(raw.openIssues ?? 0),
            topics: Array.isArray(raw.topics) ? (raw.topics as string[]) : [],
          },
        };
      case 'github_issue':
        return {
          type: 'issue',
          sourceUrl,
          data: {
            title: String(raw.title ?? ''),
            state: String(raw.state ?? ''),
            author: typeof raw.author === 'string' ? raw.author : null,
            commentCount: Number(raw.commentCount ?? 0),
            labels: Array.isArray(raw.labels)
              ? (raw.labels as unknown[]).filter((l): l is string => typeof l === 'string')
              : [],
          },
        };
      case 'github_pull':
        return {
          type: 'pull',
          sourceUrl,
          data: {
            title: String(raw.title ?? ''),
            state: String(raw.state ?? ''),
            merged: Boolean(raw.merged),
            author: typeof raw.author === 'string' ? raw.author : null,
            additions: Number(raw.additions ?? 0),
            deletions: Number(raw.deletions ?? 0),
            changedFiles: Number(raw.changedFiles ?? 0),
            reviewCommentCount: Number(raw.reviewCommentCount ?? 0),
          },
        };
      case 'github_file':
        return {
          type: 'file',
          sourceUrl,
          data: {
            path: String(raw.path ?? ''),
            size: Number(raw.size ?? 0),
          },
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
};

const TOOL_LABELS: Readonly<Record<string, string>> = {
  recall: 'Searching memory',
  get_weather: 'Checking weather',
  github: 'Looking up GitHub',
  capabilities: 'Checking capabilities',
};

export interface UseSessionReturn {
  readonly state: VoiceState;
  readonly transcript: readonly TranscriptEntry[];
  readonly vadMode: VadMode;
  readonly rttMs: number | null;
  readonly toolDigest: GitHubDigest | null;
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
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [toolDigest, setToolDigest] = useState<GitHubDigest | null>(null);

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
      name?: string;
      session?: { turn_detection?: unknown };
      item?: { type?: string; output?: string };
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

        case 'response.function_call_arguments.done': {
          const toolName = event.name ?? 'unknown';
          const label = TOOL_LABELS[toolName] ?? toolName;
          setTranscript((prev) => [
            ...prev,
            { role: 'tool' as const, text: `${label}...`, toolName, final: true },
          ]);
          if (toolName !== 'github') setToolDigest(null);
          setState('working');
          break;
        }

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

        case 'conversation.item.created': {
          if (event.item?.type === 'function_call_output' && event.item.output) {
            const digest = parseGitHubDigest(event.item.output);
            if (digest) setToolDigest(digest);
          }
          break;
        }

        case 'error':
          console.error('Realtime error:', event);
          break;

        default:
          console.debug('[DC unhandled]', event.type, event);
          break;
      }
    },
    [appendTranscript, finalizeTranscript],
  );

  // Poll WebRTC stats for round-trip time while connected
  useEffect(() => {
    const isActive = state !== 'disconnected' && state !== 'error' && state !== 'connecting';
    if (!isActive) {
      setRttMs(null);
      return;
    }

    const poll = async (): Promise<void> => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'candidate-pair') {
            const pair = report as RTCIceCandidatePairStats;
            if (pair.nominated && typeof pair.currentRoundTripTime === 'number') {
              setRttMs(Math.round(pair.currentRoundTripTime * 1000));
            }
          }
        });
      } catch {
        // PC may be closed between check and getStats
      }
    };

    const interval = setInterval(poll, 2000);
    poll(); // immediate first read
    return () => clearInterval(interval);
  }, [state]);

  const connect = useCallback(async () => {
    cleanup();
    cancelledRef.current = false;
    setState('connecting');
    setTranscript([]);
    setToolDigest(null);

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
                type: 'realtime',
                audio: {
                  input: {
                    turn_detection: {
                      type: 'semantic_vad',
                      eagerness: 'auto',
                      interrupt_response: true,
                      create_response: true,
                    },
                  },
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
            type: 'realtime',
            audio: {
              input: {
                turn_detection: {
                  type: 'semantic_vad',
                  eagerness: 'auto',
                  interrupt_response: true,
                  create_response: true,
                },
              },
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
          session: { type: 'realtime', audio: { input: { turn_detection: null } } },
        }),
      );
      if (track) track.enabled = false;
    }
  }, []);

  return {
    state,
    transcript,
    vadMode,
    rttMs,
    toolDigest,
    connect,
    disconnect,
    startTalking,
    stopTalking,
    setVadMode,
    micStream,
    remoteStream,
  };
}
