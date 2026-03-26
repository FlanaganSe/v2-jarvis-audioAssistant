import { type Db } from '../../db/index.js';
import { insertSummary } from '../../db/persistence.js';
import { turns } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';

const SUMMARY_PROMPT = `Analyze this conversation and extract structured metadata. Return valid JSON only, no markdown.

Format:
{
  "topics": ["topic1", "topic2"],
  "entities": [{"name": "...", "type": "person|place|concept|repo|tool"}],
  "keyFacts": ["fact1", "fact2"],
  "unresolved": ["question or topic left open"]
}

If any field has no entries, use an empty array.`;

interface SummaryResult {
  readonly topics: string[];
  readonly entities: Record<string, unknown>[];
  readonly keyFacts: string[];
  readonly unresolved: string[];
}

export const parseSummary = (raw: string): SummaryResult => {
  try {
    const parsed = JSON.parse(raw) as SummaryResult;
    return {
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
      unresolved: Array.isArray(parsed.unresolved) ? parsed.unresolved : [],
    };
  } catch {
    return { topics: [], entities: [], keyFacts: [], unresolved: [] };
  }
};

export const generateAndStoreSummary = async (
  db: Db,
  sessionId: string,
  apiKey: string,
): Promise<string | null> => {
  const sessionTurns = await db
    .select({ role: turns.role, content: turns.content })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.createdAt));

  if (sessionTurns.length === 0) return null;

  const transcript = sessionTurns.map((t) => `${t.role}: ${t.content}`).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const summary = parseSummary(raw);

  return insertSummary(db, sessionId, summary);
};
