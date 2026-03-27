import { type FastifyPluginAsync } from 'fastify';
import { type Db } from '../../db/index.js';
import { listSessions, getSessionDetail } from '../../db/persistence.js';

export const historyRoutes = (db?: Db): FastifyPluginAsync => {
  return async (app) => {
    app.get('/sessions', async (_req, reply) => {
      if (!db) return reply.send([]);
      const sessions = await listSessions(db);
      return sessions;
    });

    app.get<{ Params: { id: string } }>('/sessions/:id/turns', async (req, reply) => {
      if (!db) return reply.status(404).send({ error: 'Not found' });

      const detail = await getSessionDetail(db, req.params.id);
      if (!detail) return reply.status(404).send({ error: 'Session not found' });

      return detail;
    });
  };
};
