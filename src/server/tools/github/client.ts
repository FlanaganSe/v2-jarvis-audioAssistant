import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ThrottledOctokit: any = Octokit.plugin(throttling);

export interface OctokitLogger {
  readonly warn: (msg: string) => void;
}

const defaultLogger: OctokitLogger = { warn: (msg) => console.warn(msg) };

export const createOctokitClient = (token: string, log: OctokitLogger = defaultLogger): Octokit => {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: { url?: string }) => {
        log.warn(`Rate limit hit for ${options.url}, retrying after ${retryAfter}s`);
        return true;
      },
      onSecondaryRateLimit: (retryAfter: number, options: { url?: string }) => {
        log.warn(`Secondary rate limit for ${options.url}, retrying after ${retryAfter}s`);
        return true;
      },
    },
  }) as Octokit;
};
