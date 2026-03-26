import { type Db } from '../../db/index.js';
import { recallTurns, recallSummaries, type RecallQuery } from '../../db/persistence.js';

export const RECALL_TOOL_DEF = {
  type: 'function' as const,
  name: 'recall',
  description:
    'Search past conversations for context. Use when the user asks about previous sessions, what was discussed before, or references something from an earlier conversation.',
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'A search term to find in past conversation content',
      },
      timeframe: {
        type: 'string',
        enum: ['today', 'yesterday', 'this_week', 'last_week', 'all'],
        description: 'How far back to search. Defaults to all.',
      },
    },
    required: [],
  },
};

export const resolveTimeframe = (timeframe?: string): { afterDate?: Date; beforeDate?: Date } => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (timeframe) {
    case 'today':
      return { afterDate: startOfDay };
    case 'yesterday': {
      const yesterday = new Date(startOfDay);
      yesterday.setDate(yesterday.getDate() - 1);
      return { afterDate: yesterday, beforeDate: startOfDay };
    }
    case 'this_week': {
      const weekStart = new Date(startOfDay);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return { afterDate: weekStart };
    }
    case 'last_week': {
      const thisWeekStart = new Date(startOfDay);
      thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      return { afterDate: lastWeekStart, beforeDate: thisWeekStart };
    }
    default:
      return {};
  }
};

export const handleRecall = async (
  db: Db,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const keyword = typeof args.keyword === 'string' ? args.keyword : undefined;
  const timeframe = typeof args.timeframe === 'string' ? args.timeframe : undefined;
  const { afterDate, beforeDate } = resolveTimeframe(timeframe);

  const query: RecallQuery = { keyword, afterDate, beforeDate, limit: 20 };

  const [foundTurns, summaries] = await Promise.all([
    recallTurns(db, query),
    recallSummaries(db, { ...query, limit: 5 }),
  ]);

  if (foundTurns.length === 0 && summaries.length === 0) {
    return { found: false, message: 'No matching past conversations found.' };
  }

  return {
    found: true,
    turns: foundTurns.map((t) => ({
      role: t.role,
      content: t.content,
      date: t.createdAt.toISOString(),
    })),
    summaries: summaries.map((s) => ({
      topics: s.topics,
      keyFacts: s.keyFacts,
      date: s.createdAt.toISOString(),
    })),
  };
};
