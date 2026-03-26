import { describe, it, expect } from 'vitest';
import { CAPABILITIES_TOOL_DEF, handleCapabilities } from './capabilities.js';

describe('CAPABILITIES_TOOL_DEF', () => {
  it('has correct shape', () => {
    expect(CAPABILITIES_TOOL_DEF.type).toBe('function');
    expect(CAPABILITIES_TOOL_DEF.name).toBe('capabilities');
    expect(CAPABILITIES_TOOL_DEF.parameters.required).toEqual([]);
  });
});

describe('handleCapabilities', () => {
  it('returns capabilities and limitations', async () => {
    const result = await handleCapabilities();
    expect(Array.isArray(result.capabilities)).toBe(true);
    expect(Array.isArray(result.limitations)).toBe(true);
    expect((result.capabilities as string[]).length).toBeGreaterThan(0);
    expect((result.limitations as string[]).length).toBeGreaterThan(0);
    expect(result.evidence).toBeNull();
  });
});
