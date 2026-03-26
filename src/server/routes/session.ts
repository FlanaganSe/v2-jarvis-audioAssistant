import { type FastifyPluginAsync } from 'fastify';
import { type Config } from '../../config.js';
import { connectSideband, type Sideband } from '../realtime/sideband.js';

const SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.
You have an echo tool — use it when asked to echo, repeat, or test something.
When using the echo tool, relay its output to the user naturally.`;

const ECHO_TOOL_DEF = {
  type: 'function' as const,
  name: 'echo',
  description: 'Echoes back the input text. Use when asked to echo, repeat, or test.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to echo back' },
    },
    required: ['text'],
  },
};

const activeSidebands = new Map<string, Sideband>();

export const sessionRoutes = (config: Config): FastifyPluginAsync => {
  return async (app) => {
    app.post('/session', async (_req, reply) => {
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-realtime-1.5',
          voice: 'alloy',
          instructions: SYSTEM_PROMPT,
          tools: [ECHO_TOOL_DEF],
          turn_detection: null,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        return reply.status(502).send({ error: 'Failed to create session', detail });
      }

      const data = (await response.json()) as { value: string };
      return { ephemeralKey: data.value };
    });

    app.post<{ Body: { callId: string } }>('/session/sideband', async (req, reply) => {
      const { callId } = req.body;

      if (!callId || typeof callId !== 'string') {
        return reply.status(400).send({ error: 'callId is required' });
      }

      if (activeSidebands.has(callId)) {
        return { ok: true, message: 'Sideband already connected' };
      }

      try {
        const sideband = await connectSideband(callId, config.OPENAI_API_KEY);
        activeSidebands.set(callId, sideband);

        sideband.onClose(() => {
          activeSidebands.delete(callId);
        });

        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(502).send({ error: 'Failed to connect sideband', detail: message });
      }
    });
  };
};
