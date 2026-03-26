import { loadConfig } from '../config.js';
import { buildApp } from './app.js';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const app = await buildApp(config);

  await app.listen({ port: config.PORT, host: '::' });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
