import { type Db } from '../../db/index.js';
import { evidenceRecords } from '../../db/schema.js';

export interface Evidence {
  readonly sourceId: string | null;
  readonly sourceType: string;
  readonly sourceUrl: string | null;
  readonly snippet: string | null;
  readonly retrievedAt: Date;
}

export const createEvidence = (
  sourceType: string,
  sourceUrl: string | null,
  snippet: string | null,
  sourceId?: string | null,
): Evidence => ({
  sourceId: sourceId ?? null,
  sourceType,
  sourceUrl,
  snippet,
  retrievedAt: new Date(),
});

export const persistEvidence = async (db: Db, evidence: Evidence): Promise<string> => {
  const [row] = await db
    .insert(evidenceRecords)
    .values({
      sourceId: evidence.sourceId,
      sourceType: evidence.sourceType,
      sourceUrl: evidence.sourceUrl,
      snippet: evidence.snippet,
      retrievedAt: evidence.retrievedAt,
    })
    .returning({ id: evidenceRecords.id });
  return row.id;
};

export const persistManyEvidence = async (
  db: Db,
  items: readonly Evidence[],
): Promise<string[]> => {
  if (items.length === 0) return [];
  const rows = await db
    .insert(evidenceRecords)
    .values(
      items.map((e) => ({
        sourceId: e.sourceId,
        sourceType: e.sourceType,
        sourceUrl: e.sourceUrl,
        snippet: e.snippet,
        retrievedAt: e.retrievedAt,
      })),
    )
    .returning({ id: evidenceRecords.id });
  return rows.map((r) => r.id);
};
