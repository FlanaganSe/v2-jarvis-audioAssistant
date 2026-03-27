import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db/index.js';
import { buildApp } from './app.js';

const logToolAvailability = (
  app: Awaited<ReturnType<typeof buildApp>>,
  config: ReturnType<typeof loadConfig>,
): void => {
  if (!config.DATABASE_URL) {
    app.log.warn('DATABASE_URL not set — tools limited to echo only');
  }
  if (!config.GITHUB_TOKEN) {
    app.log.warn('GITHUB_TOKEN not set — GitHub tool disabled');
  }
};

const start = async (): Promise<void> => {
  const config = loadConfig();
  const db = config.DATABASE_URL ? connectDb(config.DATABASE_URL) : undefined;
  const app = await buildApp(config, db);

  logToolAvailability(app, config);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await disconnectDb();
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ port: config.PORT, host: '::' });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
