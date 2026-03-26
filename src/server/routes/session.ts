import { type FastifyPluginAsync } from 'fastify';
import { type Config } from '../../config.js';
import { connectSideband, type Sideband, type ToolHandler } from '../realtime/sideband.js';
import { type Db } from '../../db/index.js';
import { createSession, endSession, insertTurn, insertToolCall } from '../../db/persistence.js';
import { generateAndStoreSummary } from '../realtime/summary.js';
import { RECALL_TOOL_DEF, handleRecall } from '../tools/recall.js';

const BASE_SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.
You have an echo tool — use it when asked to echo, repeat, or test something.
When using the echo tool, relay its output to the user naturally.`;

const MEMORY_SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.

You have tools available:
- echo: Use when asked to echo, repeat, or test something.
- recall: Use when the user asks about previous conversations, references something from before, or asks "what did we talk about". Always use the recall tool before answering questions about past sessions.

When using tools, relay their output to the user naturally. If recall returns no results, tell the user you don't have any memory of that topic.`;

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

const buildToolHandler = (db?: Db): ToolHandler => {
  return async (name, args) => {
    if (name === 'echo') {
      return { echoed: (args as { text?: string }).text ?? '' };
    }
    if (name === 'recall' && db) {
      return handleRecall(db, args);
    }
    return { error: `Unknown tool: ${name}` };
  };
};

export const sessionRoutes = (config: Config, db?: Db): FastifyPluginAsync => {
  const toolHandler = buildToolHandler(db);
  const systemPrompt = db ? MEMORY_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  const tools = db ? [ECHO_TOOL_DEF, RECALL_TOOL_DEF] : [ECHO_TOOL_DEF];

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
          instructions: systemPrompt,
          tools,
          turn_detection: null,
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
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

      let dbSessionId: string | null = null;

      if (db) {
        try {
          const session = await createSession(db, { callId });
          dbSessionId = session.id;
        } catch (err) {
          app.log.error({ err }, 'Failed to create DB session');
        }
      }

      try {
        const sideband = await connectSideband({
          callId,
          apiKey: config.OPENAI_API_KEY,
          toolHandler,
          events:
            db && dbSessionId
              ? {
                  onUserMessage: (text) => {
                    insertTurn(db, dbSessionId!, 'user', text).catch((err) =>
                      app.log.error({ err }, 'Failed to persist user turn'),
                    );
                  },
                  onAssistantMessage: (text) => {
                    insertTurn(db, dbSessionId!, 'assistant', text).catch((err) =>
                      app.log.error({ err }, 'Failed to persist assistant turn'),
                    );
                  },
                  onToolCall: (name, args, result) => {
                    try {
                      const parsedArgs = JSON.parse(args) as Record<string, unknown>;
                      const parsedResult = JSON.parse(result) as Record<string, unknown>;
                      insertToolCall(db, null, name, parsedArgs, parsedResult).catch((err) =>
                        app.log.error({ err }, 'Failed to persist tool call'),
                      );
                    } catch (err) {
                      app.log.error({ err }, 'Failed to parse tool call args/result');
                    }
                  },
                }
              : undefined,
        });
        activeSidebands.set(callId, sideband);

        sideband.onClose(() => {
          activeSidebands.delete(callId);
          if (db && dbSessionId) {
            endSession(db, dbSessionId)
              .then(() => generateAndStoreSummary(db, dbSessionId!, config.OPENAI_API_KEY))
              .catch((err) => app.log.error({ err }, 'Failed to end session or generate summary'));
          }
        });

        return { ok: true };
      } catch (err) {
        if (db && dbSessionId) {
          endSession(db, dbSessionId).catch((e) =>
            app.log.error({ err: e }, 'Failed to clean up orphaned session'),
          );
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(502).send({ error: 'Failed to connect sideband', detail: message });
      }
    });
  };
};
