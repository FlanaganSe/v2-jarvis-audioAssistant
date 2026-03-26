import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from './parser.js';

describe('parseGitHubUrl', () => {
  it.each([
    {
      input: 'https://github.com/anthropics/claude-code',
      expected: { type: 'repo', owner: 'anthropics', repo: 'claude-code' },
    },
    {
      input: 'https://github.com/owner/repo/blob/main/src/index.ts',
      expected: { type: 'file', owner: 'owner', repo: 'repo', ref: 'main', path: 'src/index.ts' },
    },
    {
      input: 'https://github.com/owner/repo/blob/feat/branch/README.md',
      expected: {
        type: 'file',
        owner: 'owner',
        repo: 'repo',
        ref: 'feat',
        path: 'branch/README.md',
      },
    },
    {
      input: 'https://github.com/owner/repo/issues/42',
      expected: { type: 'issue', owner: 'owner', repo: 'repo', number: 42 },
    },
    {
      input: 'https://github.com/owner/repo/pull/123',
      expected: { type: 'pull', owner: 'owner', repo: 'repo', number: 123 },
    },
    {
      input: 'https://github.com/owner/repo/issues/42#issuecomment-123456',
      expected: { type: 'issue', owner: 'owner', repo: 'repo', number: 42 },
    },
    {
      input: 'https://github.com/owner/repo/pull/123#issuecomment-789',
      expected: { type: 'pull', owner: 'owner', repo: 'repo', number: 123 },
    },
  ])('parses $input', ({ input, expected }) => {
    const result = parseGitHubUrl(input);
    expect(result).toMatchObject(expected);
  });

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(parseGitHubUrl('not-a-url')).toBeNull();
  });

  it('returns null for GitHub URLs with only owner', () => {
    expect(parseGitHubUrl('https://github.com/owner')).toBeNull();
  });

  it('returns repo type for unrecognized sub-paths', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/wiki')).toEqual({
      type: 'repo',
      owner: 'owner',
      repo: 'repo',
    });
  });
});
