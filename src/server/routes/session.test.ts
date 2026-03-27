import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import { type Config } from '../../config.js';

const testConfig: Config = {
  OPENAI_API_KEY: 'sk-test-key',
  PORT: 3000,
  NODE_ENV: 'test',
};

describe('POST /api/session', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ephemeral key on success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ value: 'ek_test_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = await buildApp(testConfig);
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ephemeralKey: 'ek_test_123' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/client_secrets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test-key',
        }),
      }),
    );
  });

  it('injects current date into system prompt', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ value: 'ek_test_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = await buildApp(testConfig);
    await app.inject({ method: 'POST', url: '/api/session' });

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string) as {
      session: { instructions: string };
    };
    const now = new Date();
    const expectedYear = now.getFullYear().toString();
    expect(body.session.instructions).toContain('Current date and time:');
    expect(body.session.instructions).toContain(expectedYear);
  });

  it('returns 502 when OpenAI API fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const app = await buildApp(testConfig);
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'Failed to create session' });
  });
});

describe('POST /api/session/sideband', () => {
  it('returns 400 when callId is missing', async () => {
    const app = await buildApp(testConfig);
    const response = await app.inject({
      method: 'POST',
      url: '/api/session/sideband',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = await buildApp(testConfig);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
