import { type FastifyPluginAsync } from 'fastify';
import { type Octokit } from '@octokit/rest';
import { type Config } from '../../config.js';
import { connectSideband, type Sideband, type ToolHandler } from '../realtime/sideband.js';
import { type Db } from '../../db/index.js';
import { createSession, endSession, insertTurn, insertToolCall } from '../../db/persistence.js';
import { generateAndStoreSummary } from '../realtime/summary.js';
import { RECALL_TOOL_DEF, handleRecall } from '../tools/recall.js';
import { WEATHER_TOOL_DEF, handleWeather } from '../tools/weather.js';
import { GITHUB_TOOL_DEF, handleGitHub } from '../tools/github/tool.js';
import { CAPABILITIES_TOOL_DEF, handleCapabilities } from '../tools/capabilities.js';
import { createOctokitClient } from '../tools/github/client.js';
import { persistEvidence, createEvidence, type Evidence } from '../tools/evidence.js';

const SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.

You have tools available:
- recall: Search past conversations. Use when the user asks about previous sessions, references something from before, or asks "what did we talk about". Always use the recall tool before answering questions about past sessions.
- get_weather: Get current weather for a city. Use when the user asks about weather or temperature.
- github: Fetch information about a public GitHub repo, file, issue, or PR from a URL. Use when the user provides a GitHub URL.
- capabilities: Describe what you can and cannot do. Use when the user asks what you can help with.

Rules:
- Every factual claim must be grounded in evidence returned by your tools. Cite the source naturally (e.g., "According to the GitHub repo..." or "The current weather shows...").
- If you cannot ground your answer in evidence from tools, say a variant of "I don't know" or "I'm not sure about that" instead of guessing. Never fabricate facts.
- When calling a tool, briefly announce it first (e.g., "Let me check the weather..." or "Let me look that up on GitHub...") so the user knows you're working on it.
- If a tool fails, tell the user you're having trouble reaching that service and suggest they try again.
- Relay tool results to the user naturally and conversationally.`;

const BASE_SYSTEM_PROMPT = `You are Jarvis, a helpful voice assistant. Keep your responses brief and conversational.
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

const buildToolDefs = (hasGitHub: boolean) => [
  RECALL_TOOL_DEF,
  WEATHER_TOOL_DEF,
  ...(hasGitHub ? [GITHUB_TOOL_DEF] : []),
  CAPABILITIES_TOOL_DEF,
];

const buildSystemPrompt = (base: string): string => {
  const now = new Date();
  const dateTime = now.toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `Current date and time: ${dateTime}\n\n${base}`;
};

const activeSidebands = new Map<string, Sideband>();

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

const tryPersistEvidence = (
  db: Db | undefined,
  result: Record<string, unknown>,
  log?: LogFn,
): void => {
  if (!db) return;
  const ev = result.evidence as Record<string, unknown> | null | undefined;
  if (!ev || !ev.sourceType) return;
  const evidence: Evidence = createEvidence(
    ev.sourceType as string,
    (ev.sourceUrl as string) ?? null,
    (ev.snippet as string) ?? null,
  );
  persistEvidence(db, evidence).catch((err) => {
    log?.({ err }, 'Failed to persist evidence');
  });
};

const buildToolHandler = (
  db: Db | undefined,
  octokit: Octokit | null,
  log?: LogFn,
): ToolHandler => {
  return async (name, args) => {
    if (name === 'echo') {
      return { echoed: (args as { text?: string }).text ?? '' };
    }
    if (name === 'recall' && db) {
      return handleRecall(db, args);
    }
    if (name === 'get_weather') {
      const result = await handleWeather(args);
      tryPersistEvidence(db, result, log);
      return result;
    }
    if (name === 'github' && octokit) {
      const result = await handleGitHub(octokit, args);
      tryPersistEvidence(db, result, log);
      return result;
    }
    if (name === 'capabilities') {
      return handleCapabilities();
    }
    return { error: `Unknown tool: ${name}` };
  };
};

export const sessionRoutes = (config: Config, db?: Db): FastifyPluginAsync => {
  const hasFullTools = !!db;
  const basePrompt = hasFullTools ? SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;

  return async (app) => {
    const octokit = config.GITHUB_TOKEN
      ? createOctokitClient(config.GITHUB_TOKEN, { warn: (msg) => app.log.warn(msg) })
      : null;
    const tools = hasFullTools ? buildToolDefs(!!octokit) : [ECHO_TOOL_DEF];
    const toolHandler = buildToolHandler(db, octokit, app.log.warn.bind(app.log));
    app.post('/session', async (_req, reply) => {
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: 'gpt-realtime-1.5',
            instructions: buildSystemPrompt(basePrompt),
            tools,
            audio: {
              input: {
                transcription: { model: 'gpt-4o-mini-transcribe' },
                turn_detection: null,
              },
              output: { voice: 'alloy' },
            },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        return reply.status(502).send({ error: 'Failed to create session', detail });
      }

      const data = (await response.json()) as { value: string };
      return { ephemeralKey: data.value };
    });

    app.post<{ Body: { callId: string; ephemeralKey?: string } }>(
      '/session/sideband',
      async (req, reply) => {
        const { callId, ephemeralKey } = req.body;

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

        const sidebandKey =
          typeof ephemeralKey === 'string' && ephemeralKey.length > 0
            ? ephemeralKey
            : config.OPENAI_API_KEY;

        try {
          const sideband = await connectSideband({
            callId,
            apiKey: sidebandKey,
            toolHandler,
            log: app.log,
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
                // Ephemeral key is expired by session close; use long-lived key for summary
                .then(() => generateAndStoreSummary(db, dbSessionId!, config.OPENAI_API_KEY))
                .catch((err) =>
                  app.log.error({ err }, 'Failed to end session or generate summary'),
                );
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
      },
    );
  };
};
