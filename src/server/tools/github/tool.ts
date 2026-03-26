import { type Octokit } from '@octokit/rest';
import { parseGitHubUrl } from './parser.js';
import { fetchGitHubEntity } from './fetchers.js';

export const GITHUB_TOOL_DEF = {
  type: 'function' as const,
  name: 'github',
  description:
    'Fetch information about a GitHub repository, file, issue, or pull request from a URL. Use when the user provides a GitHub URL or asks about a GitHub resource.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The GitHub URL to fetch (repo, file, issue, or PR)',
      },
    },
    required: ['url'],
  },
};

export const handleGitHub = async (
  octokit: Octokit,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) {
    return { error: 'A GitHub URL is required', evidence: null };
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return { error: `"${url}" is not a valid GitHub URL`, evidence: null };
  }

  try {
    const result = await fetchGitHubEntity(octokit, parsed);
    return {
      ...result.data,
      evidence: {
        sourceType: result.evidence.sourceType,
        sourceUrl: result.evidence.sourceUrl,
        snippet: result.evidence.snippet,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      error: `Failed to fetch GitHub resource: ${message}`,
      evidence: null,
    };
  }
};
