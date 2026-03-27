import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { type Config } from '../../config.js';
import * as persistence from '../../db/persistence.js';

const testConfig: Config = {
  OPENAI_API_KEY: 'sk-test-key',
  PORT: 3000,
  NODE_ENV: 'test',
};

vi.mock('../../db/persistence.js', async (importOriginal) => {
  const original = await importOriginal<typeof persistence>();
  return {
    ...original,
    listSessions: vi.fn(),
    getSessionDetail: vi.fn(),
  };
});

describe('GET /api/sessions', () => {
  it('returns empty array when no db is configured', async () => {
    const app = await buildApp(testConfig);
    const response = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /api/sessions/:id/turns', () => {
  it('returns 404 when no db is configured', async () => {
    const app = await buildApp(testConfig);
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/some-id/turns',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not found' });
  });
});

describe('history routes with db', () => {
  const mockDb = {} as persistence.CreateSessionResult & Record<string, unknown>;

  beforeEach(() => {
    vi.mocked(persistence.listSessions).mockReset();
    vi.mocked(persistence.getSessionDetail).mockReset();
  });

  it('GET /api/sessions returns session list from db', async () => {
    const mockSessions = [
      {
        id: '1',
        startedAt: new Date('2026-03-26T10:00:00Z'),
        endedAt: new Date('2026-03-26T10:30:00Z'),
        topics: ['weather', 'github'],
      },
    ];
    vi.mocked(persistence.listSessions).mockResolvedValue(mockSessions);

    const app = await buildApp(testConfig, mockDb as never);
    const response = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('1');
    expect(body[0].topics).toEqual(['weather', 'github']);
  });

  it('GET /api/sessions/:id/turns returns session detail', async () => {
    const mockDetail = {
      id: '1',
      startedAt: new Date('2026-03-26T10:00:00Z'),
      endedAt: null,
      turns: [
        {
          id: 't1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date('2026-03-26T10:00:01Z'),
        },
        {
          id: 't2',
          role: 'assistant',
          content: 'Hi there!',
          createdAt: new Date('2026-03-26T10:00:02Z'),
        },
      ],
    };
    vi.mocked(persistence.getSessionDetail).mockResolvedValue(mockDetail);

    const app = await buildApp(testConfig, mockDb as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/1/turns',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('1');
    expect(body.turns).toHaveLength(2);
    expect(body.turns[0].role).toBe('user');
  });

  it('GET /api/sessions/:id/turns returns 404 for unknown session', async () => {
    vi.mocked(persistence.getSessionDetail).mockResolvedValue(null);

    const app = await buildApp(testConfig, mockDb as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/nonexistent/turns',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Session not found' });
  });
});
