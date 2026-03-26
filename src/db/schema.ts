import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

export const turns = pgTable('turns', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessionSummaries = pgTable('session_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  topics: text('topics').array(),
  entities: jsonb('entities').$type<Record<string, unknown>[]>(),
  keyFacts: jsonb('key_facts').$type<string[]>(),
  unresolved: jsonb('unresolved').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  turnId: uuid('turn_id').references(() => turns.id),
  toolName: text('tool_name').notNull(),
  args: jsonb('args').$type<Record<string, unknown>>(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceRecords = pgTable('evidence_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: text('source_id'),
  sourceType: text('source_type').notNull(),
  sourceUrl: text('source_url'),
  snippet: text('snippet'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
});
