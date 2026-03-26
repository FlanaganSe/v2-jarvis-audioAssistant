import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const validEnv = {
    OPENAI_API_KEY: 'sk-test-key-123',
    PORT: '4000',
    NODE_ENV: 'production' as const,
  };

  it('parses valid env vars', () => {
    const config = loadConfig(validEnv);
    expect(config.OPENAI_API_KEY).toBe('sk-test-key-123');
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('production');
  });

  it('applies defaults for PORT and NODE_ENV', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws on missing OPENAI_API_KEY', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('throws on empty OPENAI_API_KEY', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: '' })).toThrow();
  });

  it('throws on invalid NODE_ENV', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'sk-test', NODE_ENV: 'staging' })).toThrow();
  });

  it('coerces PORT string to number', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-test', PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });
});
