import WebSocket from 'ws';

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
  [key: string]: unknown;
}

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

const handleToolCall = (ws: WebSocket, event: RealtimeEvent): void => {
  if (event.name === 'echo') {
    try {
      const args = JSON.parse(event.arguments ?? '{}') as { text?: string };
      sendToolResult(ws, event.call_id, JSON.stringify({ echoed: args.text ?? '' }));
    } catch {
      sendToolResult(
        ws,
        event.call_id,
        JSON.stringify({ error: 'Failed to parse tool arguments' }),
      );
    }
  } else {
    sendToolResult(ws, event.call_id, JSON.stringify({ error: `Unknown tool: ${event.name}` }));
  }
};

export const connectSideband = (callId: string, apiKey: string): Promise<Sideband> => {
  return new Promise((resolve, reject) => {
    const url = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const closeCallbacks: Array<() => void> = [];
    let resolved = false;

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

      resolve({
        callId,
        close: () => ws.close(),
        onClose: (cb) => closeCallbacks.push(cb),
      });
    });

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as RealtimeEvent;

        if (event.type === 'response.function_call_arguments.done') {
          handleToolCall(ws, event);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    ws.on('close', () => {
      closeCallbacks.forEach((cb) => cb());
    });
  });
};
