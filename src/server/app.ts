import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { type Config } from '../config.js';
import { type Db } from '../db/index.js';
import { sessionRoutes } from './routes/session.js';

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
    root: join(process.cwd(), 'public'),
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  await app.register(sessionRoutes(config, db), { prefix: '/api' });

  return app;
};
