import { describe, it, expect, vi } from 'vitest';
import { RECALL_TOOL_DEF, resolveTimeframe } from './recall.js';

describe('RECALL_TOOL_DEF', () => {
  it('has correct function definition shape', () => {
    expect(RECALL_TOOL_DEF.type).toBe('function');
    expect(RECALL_TOOL_DEF.name).toBe('recall');
    expect(RECALL_TOOL_DEF.parameters.type).toBe('object');
    expect(RECALL_TOOL_DEF.parameters.properties.keyword).toBeDefined();
    expect(RECALL_TOOL_DEF.parameters.properties.timeframe).toBeDefined();
  });
});

describe('resolveTimeframe', () => {
  it('returns empty for undefined timeframe', () => {
    expect(resolveTimeframe(undefined)).toEqual({});
  });

  it('returns empty for "all" timeframe', () => {
    expect(resolveTimeframe('all')).toEqual({});
  });

  it('returns start of today for "today"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T14:30:00Z'));

    const result = resolveTimeframe('today');
    expect(result.afterDate).toBeDefined();
    expect(result.beforeDate).toBeUndefined();
    expect(result.afterDate!.getHours()).toBe(0);
    expect(result.afterDate!.getMinutes()).toBe(0);

    vi.useRealTimers();
  });

  it('returns yesterday boundaries for "yesterday"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T14:30:00Z'));

    const result = resolveTimeframe('yesterday');
    expect(result.afterDate).toBeDefined();
    expect(result.beforeDate).toBeDefined();
    expect(result.afterDate!.getDate()).toBe(25);
    expect(result.beforeDate!.getDate()).toBe(26);

    vi.useRealTimers();
  });

  it('returns week boundaries for "this_week"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T14:30:00Z'));

    const result = resolveTimeframe('this_week');
    expect(result.afterDate).toBeDefined();
    expect(result.beforeDate).toBeUndefined();
    expect(result.afterDate!.getDay()).toBe(0);

    vi.useRealTimers();
  });

  it('returns last week boundaries for "last_week"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T14:30:00Z'));

    const result = resolveTimeframe('last_week');
    expect(result.afterDate).toBeDefined();
    expect(result.beforeDate).toBeDefined();
    expect(result.afterDate!.getDay()).toBe(0);
    expect(result.beforeDate!.getDay()).toBe(0);

    const diff = result.beforeDate!.getTime() - result.afterDate!.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);

    vi.useRealTimers();
  });
});
