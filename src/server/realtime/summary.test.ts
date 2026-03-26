import { describe, it, expect } from 'vitest';
import { parseSummary } from './summary.js';

describe('parseSummary', () => {
  it('parses valid JSON summary', () => {
    const raw = JSON.stringify({
      topics: ['weather', 'travel'],
      entities: [{ name: 'Paris', type: 'place' }],
      keyFacts: ['User is going to Paris next week'],
      unresolved: ['Budget for the trip'],
    });

    const result = parseSummary(raw);
    expect(result.topics).toEqual(['weather', 'travel']);
    expect(result.entities).toEqual([{ name: 'Paris', type: 'place' }]);
    expect(result.keyFacts).toEqual(['User is going to Paris next week']);
    expect(result.unresolved).toEqual(['Budget for the trip']);
  });

  it('handles empty JSON', () => {
    const result = parseSummary('{}');
    expect(result.topics).toEqual([]);
    expect(result.entities).toEqual([]);
    expect(result.keyFacts).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('handles invalid JSON gracefully', () => {
    const result = parseSummary('not json');
    expect(result.topics).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  it('handles partial fields', () => {
    const raw = JSON.stringify({ topics: ['testing'] });
    const result = parseSummary(raw);
    expect(result.topics).toEqual(['testing']);
    expect(result.entities).toEqual([]);
  });

  it('handles non-array fields', () => {
    const raw = JSON.stringify({ topics: 'not-an-array', keyFacts: 42 });
    const result = parseSummary(raw);
    expect(result.topics).toEqual([]);
    expect(result.keyFacts).toEqual([]);
  });
});
