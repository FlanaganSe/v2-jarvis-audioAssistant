import type { GitHubDigest, RepoDigest, IssueDigest, PullDigest, FileDigest } from '../types.ts';

function RepoCard({ data }: { readonly data: RepoDigest }) {
  return (
    <>
      <div className="text-sm font-semibold text-gray-200">{data.name}</div>
      {data.description && <div className="mt-1 text-xs text-gray-400">{data.description}</div>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
        {data.language && <span>{data.language}</span>}
        <span>{data.stars.toLocaleString()} stars</span>
        <span>{data.forks.toLocaleString()} forks</span>
        <span>{data.openIssues} open issues</span>
      </div>
      {data.topics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.topics.slice(0, 8).map((t) => (
            <span key={t} className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
              {t}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function IssueCard({ data }: { readonly data: IssueDigest }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            data.state === 'open' ? 'bg-green-800 text-green-200' : 'bg-purple-800 text-purple-200'
          }`}
        >
          {data.state}
        </span>
        <span className="text-sm font-semibold text-gray-200">{data.title}</span>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-gray-400">
        {data.author && <span>by {data.author}</span>}
        <span>{data.commentCount} comments</span>
      </div>
      {data.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.labels.map((l) => (
            <span key={l} className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
              {l}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function PullCard({ data }: { readonly data: PullDigest }) {
  const stateLabel = data.merged ? 'merged' : data.state;
  const stateColor = data.merged
    ? 'bg-purple-800 text-purple-200'
    : data.state === 'open'
      ? 'bg-green-800 text-green-200'
      : 'bg-red-800 text-red-200';

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateColor}`}>
          {stateLabel}
        </span>
        <span className="text-sm font-semibold text-gray-200">{data.title}</span>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-gray-400">
        {data.author && <span>by {data.author}</span>}
        <span className="text-green-400">+{data.additions}</span>
        <span className="text-red-400">-{data.deletions}</span>
        <span>{data.changedFiles} files</span>
        <span>{data.reviewCommentCount} reviews</span>
      </div>
    </>
  );
}

function FileCard({ data }: { readonly data: FileDigest }) {
  return (
    <>
      <div className="text-sm font-semibold text-gray-200">{data.path}</div>
      <div className="mt-1 text-xs text-gray-400">{(data.size / 1024).toFixed(1)} KB</div>
    </>
  );
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  repo: 'Repository',
  issue: 'Issue',
  pull: 'Pull Request',
  file: 'File',
};

function DigestCard({ digest }: { readonly digest: GitHubDigest }) {
  switch (digest.type) {
    case 'repo':
      return <RepoCard data={digest.data} />;
    case 'issue':
      return <IssueCard data={digest.data} />;
    case 'pull':
      return <PullCard data={digest.data} />;
    case 'file':
      return <FileCard data={digest.data} />;
  }
}

export function GitHubDigestPanel({ digest }: { readonly digest: GitHubDigest | null }) {
  if (!digest) return null;

  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">GitHub {TYPE_LABELS[digest.type]}</span>
        {digest.sourceUrl && (
          <a
            href={digest.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-500 hover:text-cyan-400"
          >
            View on GitHub
          </a>
        )}
      </div>
      <DigestCard digest={digest} />
    </div>
  );
}
