import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db/index.js';
import { buildApp } from './app.js';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const db = config.DATABASE_URL ? connectDb(config.DATABASE_URL) : undefined;
  const app = await buildApp(config, db);

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
