import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { type Config } from '../config.js';
import { type Db } from '../db/index.js';
import { sessionRoutes } from './routes/session.js';
import { historyRoutes } from './routes/history.js';

const resolveStaticRoot = (): string => {
  const clientDist = join(process.cwd(), 'client', 'dist');
  if (existsSync(clientDist)) return clientDist;
  return join(process.cwd(), 'public');
};

export const buildApp = async (config: Config, db?: Db): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? false : true,
  });
  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
  });
  await app.register(fastifyStatic, {
    root: resolveStaticRoot(),
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  await app.register(sessionRoutes(config, db), { prefix: '/api' });
  await app.register(historyRoutes(db), { prefix: '/api' });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.status(200).sendFile('index.html');
  });

  return app;
};
