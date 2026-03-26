import { describe, it, expect, vi } from 'vitest';
import { handleGitHub, GITHUB_TOOL_DEF } from './tool.js';

const mockOctokit = (overrides: Record<string, unknown> = {}) =>
  ({
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({
          data: {
            full_name: 'owner/repo',
            description: 'A test repo',
            language: 'TypeScript',
            stargazers_count: 100,
            forks_count: 10,
            open_issues_count: 5,
            default_branch: 'main',
            topics: ['test'],
          },
        }),
        getReadme: vi.fn().mockResolvedValue({
          data: {
            content: Buffer.from('# Test README').toString('base64'),
            encoding: 'base64',
          },
        }),
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: 'file',
            path: 'src/index.ts',
            size: 100,
            content: Buffer.from('export const hello = "world";').toString('base64'),
            encoding: 'base64',
          },
        }),
      },
      issues: {
        get: vi.fn().mockResolvedValue({
          data: {
            title: 'Test issue',
            state: 'open',
            user: { login: 'testuser' },
            body: 'Issue body',
            labels: [{ name: 'bug' }],
          },
        }),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
      },
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            title: 'Test PR',
            state: 'open',
            merged: false,
            user: { login: 'testuser' },
            body: 'PR body',
            base: { ref: 'main' },
            head: { ref: 'feature' },
            additions: 10,
            deletions: 5,
            changed_files: 3,
          },
        }),
        listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
      },
      ...overrides,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('GITHUB_TOOL_DEF', () => {
  it('has correct shape', () => {
    expect(GITHUB_TOOL_DEF.type).toBe('function');
    expect(GITHUB_TOOL_DEF.name).toBe('github');
    expect(GITHUB_TOOL_DEF.parameters.required).toEqual(['url']);
  });
});

describe('handleGitHub', () => {
  it('returns error for empty URL', async () => {
    const result = await handleGitHub(mockOctokit(), {});
    expect(result.error).toBe('A GitHub URL is required');
  });

  it('returns error for invalid URL', async () => {
    const result = await handleGitHub(mockOctokit(), { url: 'not-a-url' });
    expect(result.error).toContain('not a valid GitHub URL');
  });

  it('fetches repo data', async () => {
    const result = await handleGitHub(mockOctokit(), {
      url: 'https://github.com/owner/repo',
    });
    expect(result.name).toBe('owner/repo');
    expect(result.description).toBe('A test repo');
    expect(result.readme).toBe('# Test README');
    expect(result.evidence).toBeDefined();
  });

  it('fetches file data', async () => {
    const result = await handleGitHub(mockOctokit(), {
      url: 'https://github.com/owner/repo/blob/main/src/index.ts',
    });
    expect(result.content).toBe('export const hello = "world";');
    expect(result.evidence).toBeDefined();
  });

  it('fetches issue data', async () => {
    const result = await handleGitHub(mockOctokit(), {
      url: 'https://github.com/owner/repo/issues/42',
    });
    expect(result.title).toBe('Test issue');
    expect(result.state).toBe('open');
    expect(result.evidence).toBeDefined();
  });

  it('fetches PR data', async () => {
    const result = await handleGitHub(mockOctokit(), {
      url: 'https://github.com/owner/repo/pull/123',
    });
    expect(result.title).toBe('Test PR');
    expect(result.merged).toBe(false);
    expect(result.evidence).toBeDefined();
  });

  it('handles API errors gracefully', async () => {
    const octokit = mockOctokit({
      repos: {
        get: vi.fn().mockRejectedValue(new Error('Not Found')),
        getReadme: vi.fn(),
        getContent: vi.fn(),
      },
    });
    const result = await handleGitHub(octokit, { url: 'https://github.com/owner/repo' });
    expect(result.error).toContain('Failed to fetch GitHub resource');
  });
});
