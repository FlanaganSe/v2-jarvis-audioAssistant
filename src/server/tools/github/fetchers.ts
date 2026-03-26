import { type Octokit } from '@octokit/rest';
import { createEvidence, type Evidence } from '../evidence.js';
import { type ParsedGitHubUrl } from './parser.js';

const MAX_CONTENT_SIZE = 1_000_000; // 1MB
const MAX_SNIPPET_LENGTH = 4000;

const truncate = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max) + '\n...[truncated]' : text;

export interface FetchResult {
  readonly data: Record<string, unknown>;
  readonly evidence: Evidence;
}

export const fetchRepo = async (
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FetchResult> => {
  const { data } = await octokit.rest.repos.get({ owner, repo });

  let readme: string | null = null;
  try {
    const { data: readmeData } = await octokit.rest.repos.getReadme({ owner, repo });
    if (readmeData.content && readmeData.encoding === 'base64') {
      readme = truncate(
        Buffer.from(readmeData.content, 'base64').toString('utf-8'),
        MAX_SNIPPET_LENGTH,
      );
    }
  } catch {
    // No README
  }

  const url = `https://github.com/${owner}/${repo}`;
  return {
    data: {
      name: data.full_name,
      description: data.description,
      language: data.language,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      defaultBranch: data.default_branch,
      topics: data.topics,
      readme,
    },
    evidence: createEvidence(
      'github_repo',
      url,
      `Repository: ${data.full_name} — ${data.description ?? 'No description'}`,
    ),
  };
};

export const fetchFile = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<FetchResult> => {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });

  if (Array.isArray(data) || data.type !== 'file') {
    return {
      data: { error: 'Path is a directory, not a file' },
      evidence: createEvidence(
        'github_file',
        `https://github.com/${owner}/${repo}/blob/${ref}/${path}`,
        null,
      ),
    };
  }

  if (data.size > MAX_CONTENT_SIZE) {
    return {
      data: { error: `File too large (${data.size} bytes). Maximum is ${MAX_CONTENT_SIZE} bytes.` },
      evidence: createEvidence(
        'github_file',
        `https://github.com/${owner}/${repo}/blob/${ref}/${path}`,
        null,
      ),
    };
  }

  let content = '';
  if (data.content && data.encoding === 'base64') {
    content = Buffer.from(data.content, 'base64').toString('utf-8');
  }

  const url = `https://github.com/${owner}/${repo}/blob/${ref}/${path}`;
  return {
    data: {
      path: data.path,
      size: data.size,
      content: truncate(content, MAX_SNIPPET_LENGTH),
    },
    evidence: createEvidence('github_file', url, truncate(content, 500)),
  };
};

export const fetchIssue = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<FetchResult> => {
  const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 50,
  });

  const url = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  return {
    data: {
      title: issue.title,
      state: issue.state,
      author: issue.user?.login,
      body: truncate(issue.body ?? '', MAX_SNIPPET_LENGTH),
      labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      commentCount: comments.length,
      comments: comments.map((c) => ({
        author: c.user?.login,
        body: truncate(c.body ?? '', 1000),
        createdAt: c.created_at,
      })),
    },
    evidence: createEvidence(
      'github_issue',
      url,
      `Issue #${issueNumber}: ${issue.title} (${issue.state})`,
    ),
  };
};

export const fetchPull = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<FetchResult> => {
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 50,
  });
  const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 50,
  });

  const url = `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
  return {
    data: {
      title: pr.title,
      state: pr.state,
      merged: pr.merged,
      author: pr.user?.login,
      body: truncate(pr.body ?? '', MAX_SNIPPET_LENGTH),
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      commentCount: comments.length,
      comments: comments.map((c) => ({
        author: c.user?.login,
        body: truncate(c.body ?? '', 1000),
        createdAt: c.created_at,
      })),
      reviewCommentCount: reviewComments.length,
      reviewComments: reviewComments.slice(0, 20).map((c) => ({
        author: c.user?.login,
        body: truncate(c.body, 500),
        path: c.path,
        createdAt: c.created_at,
      })),
    },
    evidence: createEvidence(
      'github_pull',
      url,
      `PR #${pullNumber}: ${pr.title} (${pr.state}${pr.merged ? ', merged' : ''})`,
    ),
  };
};

export const fetchGitHubEntity = async (
  octokit: Octokit,
  parsed: ParsedGitHubUrl,
): Promise<FetchResult> => {
  switch (parsed.type) {
    case 'repo':
      return fetchRepo(octokit, parsed.owner, parsed.repo);
    case 'file': {
      if (!parsed.ref || parsed.path === undefined) {
        return {
          data: { error: 'File URL must include a branch/ref and file path' },
          evidence: createEvidence('github_file', null, null),
        };
      }
      return fetchFile(octokit, parsed.owner, parsed.repo, parsed.ref, parsed.path);
    }
    case 'issue': {
      if (!parsed.number) {
        return {
          data: { error: 'Issue URL must include an issue number' },
          evidence: createEvidence('github_issue', null, null),
        };
      }
      return fetchIssue(octokit, parsed.owner, parsed.repo, parsed.number);
    }
    case 'pull': {
      if (!parsed.number) {
        return {
          data: { error: 'PR URL must include a pull request number' },
          evidence: createEvidence('github_pull', null, null),
        };
      }
      return fetchPull(octokit, parsed.owner, parsed.repo, parsed.number);
    }
  }
};
