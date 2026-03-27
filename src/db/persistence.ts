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

export interface SessionListItem {
  readonly id: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly topics: string[] | null;
}

export const listSessions = async (
  db: Db,
  limit: number = 20,
): Promise<readonly SessionListItem[]> => {
  const rows = await db
    .select({
      id: sessions.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      topics: sessionSummaries.topics,
    })
    .from(sessions)
    .leftJoin(sessionSummaries, eq(sessionSummaries.sessionId, sessions.id))
    .orderBy(desc(sessions.startedAt))
    .limit(limit);

  return rows;
};

export interface SessionTurn {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: Date;
}

export interface SessionSummaryData {
  readonly topics: string[] | null;
  readonly keyFacts: string[] | null;
  readonly unresolved: string[] | null;
}

export interface SessionDetail {
  readonly id: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly turns: readonly SessionTurn[];
  readonly summary: SessionSummaryData | null;
}

export const getSessionDetail = async (
  db: Db,
  sessionId: string,
): Promise<SessionDetail | null> => {
  const [session] = await db
    .select({
      id: sessions.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) return null;

  const sessionTurns = await db
    .select({
      id: turns.id,
      role: turns.role,
      content: turns.content,
      createdAt: turns.createdAt,
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(turns.createdAt);

  const [summaryRow] = await db
    .select({
      topics: sessionSummaries.topics,
      keyFacts: sessionSummaries.keyFacts,
      unresolved: sessionSummaries.unresolved,
    })
    .from(sessionSummaries)
    .where(eq(sessionSummaries.sessionId, sessionId))
    .limit(1);

  const summary: SessionSummaryData | null = summaryRow
    ? {
        topics: summaryRow.topics,
        keyFacts: summaryRow.keyFacts,
        unresolved: summaryRow.unresolved,
      }
    : null;

  return { ...session, turns: sessionTurns, summary };
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
