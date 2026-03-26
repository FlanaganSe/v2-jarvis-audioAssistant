import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { type Config } from '../config.js';
import { sessionRoutes } from './routes/session.js';

export const buildApp = async (config: Config): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? false : true,
  });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(sessionRoutes(config), { prefix: '/api' });

  return app;
};
