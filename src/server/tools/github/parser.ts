export type GitHubUrlType = 'repo' | 'file' | 'issue' | 'pull';

export interface ParsedGitHubUrl {
  readonly type: GitHubUrlType;
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly path?: string;
  readonly number?: number;
}

export const parseGitHubUrl = (input: string): ParsedGitHubUrl | null => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1];

  if (parts.length === 2) {
    return { type: 'repo', owner, repo };
  }

  if (parts[2] === 'blob' && parts.length >= 5) {
    const ref = parts[3];
    const path = parts.slice(4).join('/');
    return { type: 'file', owner, repo, ref, path };
  }

  if (parts[2] === 'issues' && parts.length >= 4) {
    const num = parseInt(parts[3], 10);
    if (isNaN(num)) return null;
    return { type: 'issue', owner, repo, number: num };
  }

  if (parts[2] === 'pull' && parts.length >= 4) {
    const num = parseInt(parts[3], 10);
    if (isNaN(num)) return null;
    return { type: 'pull', owner, repo, number: num };
  }

  return { type: 'repo', owner, repo };
};
