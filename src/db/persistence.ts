import { eq, desc, sql, and, gte, lte, type SQL } from 'drizzle-orm';
import { type Db } from './index.js';
import { sessions, turns, sessionSummaries, toolCalls } from './schema.js';

export interface CreateSessionResult {
  readonly id: string;
  readonly startedAt: Date;
}

export const createSession = async (
  db: Db,
  metadata?: Record<string, unknown>,
): Promise<CreateSessionResult> => {
  const [row] = await db
    .insert(sessions)
    .values({ metadata: metadata ?? null })
    .returning({ id: sessions.id, startedAt: sessions.startedAt });
  return row;
};

export const endSession = async (db: Db, sessionId: string): Promise<void> => {
  await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.id, sessionId));
};

export const insertTurn = async (
  db: Db,
  sessionId: string,
  role: string,
  content: string,
): Promise<string> => {
  const [row] = await db
    .insert(turns)
    .values({ sessionId, role, content })
    .returning({ id: turns.id });
  return row.id;
};

export const insertToolCall = async (
  db: Db,
  turnId: string | null,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): Promise<string> => {
  const [row] = await db
    .insert(toolCalls)
    .values({ turnId, toolName, args, result })
    .returning({ id: toolCalls.id });
  return row.id;
};

export const insertSummary = async (
  db: Db,
  sessionId: string,
  summary: {
    readonly topics: string[];
    readonly entities: Record<string, unknown>[];
    readonly keyFacts: string[];
    readonly unresolved: string[];
  },
): Promise<string> => {
  const [row] = await db
    .insert(sessionSummaries)
    .values({
      sessionId,
      topics: summary.topics,
      entities: summary.entities,
      keyFacts: summary.keyFacts,
      unresolved: summary.unresolved,
    })
    .returning({ id: sessionSummaries.id });
  return row.id;
};

export interface RecallQuery {
  readonly keyword?: string;
  readonly afterDate?: Date;
  readonly beforeDate?: Date;
  readonly limit?: number;
}

export interface RecalledTurn {
  readonly role: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly sessionId: string;
}

export const recallTurns = async (db: Db, query: RecallQuery): Promise<readonly RecalledTurn[]> => {
  const conditions: SQL[] = [];

  if (query.keyword) {
    conditions.push(
      sql`to_tsvector('english', ${turns.content}) @@ plainto_tsquery('english', ${query.keyword})`,
    );
  }
  if (query.afterDate) {
    conditions.push(gte(turns.createdAt, query.afterDate));
  }
  if (query.beforeDate) {
    conditions.push(lte(turns.createdAt, query.beforeDate));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      role: turns.role,
      content: turns.content,
      createdAt: turns.createdAt,
      sessionId: turns.sessionId,
    })
    .from(turns)
    .where(where)
    .orderBy(desc(turns.createdAt))
    .limit(query.limit ?? 20);

  return rows;
};

export interface RecalledSummary {
  readonly sessionId: string;
  readonly topics: string[] | null;
  readonly keyFacts: string[] | null;
  readonly createdAt: Date;
}

export const recallSummaries = async (
  db: Db,
  query: RecallQuery,
): Promise<readonly RecalledSummary[]> => {
  const conditions: SQL[] = [];

  if (query.keyword) {
    const pattern = `%${query.keyword}%`;
    conditions.push(
      sql`EXISTS (SELECT 1 FROM unnest(${sessionSummaries.topics}) AS t WHERE t ILIKE ${pattern})`,
    );
  }
  if (query.afterDate) {
    conditions.push(gte(sessionSummaries.createdAt, query.afterDate));
  }
  if (query.beforeDate) {
    conditions.push(lte(sessionSummaries.createdAt, query.beforeDate));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      sessionId: sessionSummaries.sessionId,
      topics: sessionSummaries.topics,
      keyFacts: sessionSummaries.keyFacts,
      createdAt: sessionSummaries.createdAt,
    })
    .from(sessionSummaries)
    .where(where)
    .orderBy(desc(sessionSummaries.createdAt))
    .limit(query.limit ?? 5);

  return rows;
};
