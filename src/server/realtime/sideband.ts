import WebSocket from 'ws';

export interface SidebandEvents {
  readonly onAssistantMessage?: (text: string) => void;
  readonly onUserMessage?: (text: string) => void;
  readonly onToolCall?: (name: string, args: string, result: string) => void;
}

export interface Sideband {
  readonly callId: string;
  readonly close: () => void;
  readonly onClose: (cb: () => void) => void;
}

interface RealtimeEvent {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  transcript?: string;
  [key: string]: unknown;
}

export type ToolHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const sendToolResult = (ws: WebSocket, callId: string | undefined, output: string): void => {
  ws.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output,
      },
    }),
  );
  ws.send(JSON.stringify({ type: 'response.create' }));
};

const defaultToolHandler: ToolHandler = async (name, args) => {
  if (name === 'echo') {
    return { echoed: (args as { text?: string }).text ?? '' };
  }
  return { error: `Unknown tool: ${name}` };
};

export interface SidebandLog {
  readonly info: (obj: Record<string, unknown>, msg: string) => void;
  readonly warn: (obj: Record<string, unknown>, msg: string) => void;
  readonly error: (obj: Record<string, unknown>, msg: string) => void;
}

const noopLog: SidebandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface ConnectSidebandOptions {
  readonly callId: string;
  readonly apiKey: string;
  readonly events?: SidebandEvents;
  readonly toolHandler?: ToolHandler;
  readonly log?: SidebandLog;
}

export const connectSideband = (opts: ConnectSidebandOptions): Promise<Sideband> => {
  const { callId, apiKey, events, toolHandler = defaultToolHandler, log = noopLog } = opts;

  return new Promise((resolve, reject) => {
    const url = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const closeCallbacks: Array<() => void> = [];
    let resolved = false;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('Sideband connection timed out'));
      }
    }, 10_000);

    ws.on('open', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      log.info({ callId }, 'Sideband WebSocket connected');

      keepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 25_000);

      resolve({
        callId,
        close: () => {
          if (keepalive) clearInterval(keepalive);
          ws.close();
        },
        onClose: (cb) => closeCallbacks.push(cb),
      });
    });

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as RealtimeEvent;

        if (event.type === 'response.function_call_arguments.done') {
          const name = event.name ?? 'unknown';
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(event.arguments ?? '{}') as Record<string, unknown>;
          } catch {
            /* invalid args */
          }

          log.info({ callId, tool: name }, 'Dispatching tool call');
          toolHandler(name, parsedArgs)
            .then((result) => {
              const output = JSON.stringify(result);
              sendToolResult(ws, event.call_id, output);
              events?.onToolCall?.(name, event.arguments ?? '{}', output);
            })
            .catch((err: unknown) => {
              log.error({ callId, tool: name, err }, 'Tool execution failed');
              const errorOutput = JSON.stringify({ error: 'Tool execution failed' });
              sendToolResult(ws, event.call_id, errorOutput);
            });
        }

        if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
          events?.onAssistantMessage?.(event.transcript);
        }

        if (
          event.type === 'conversation.item.input_audio_transcription.completed' &&
          event.transcript
        ) {
          events?.onUserMessage?.(event.transcript);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    ws.on('error', (err) => {
      if (keepalive) clearInterval(keepalive);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log.error({ callId, err }, 'Sideband WebSocket connection failed');
        reject(err);
      } else {
        log.error({ callId, err }, 'Sideband WebSocket error after connect');
      }
    });

    ws.on('close', (code, reason) => {
      if (keepalive) clearInterval(keepalive);
      log.info({ callId, code, reason: reason.toString() }, 'Sideband WebSocket closed');
      closeCallbacks.forEach((cb) => cb());
    });
  });
};
