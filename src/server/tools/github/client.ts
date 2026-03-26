import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ThrottledOctokit: any = Octokit.plugin(throttling);

export const createOctokitClient = (token: string): Octokit => {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: { url?: string }) => {
        console.warn(`Rate limit hit for ${options.url}, retrying after ${retryAfter}s`);
        return true;
      },
      onSecondaryRateLimit: (retryAfter: number, options: { url?: string }) => {
        console.warn(`Secondary rate limit for ${options.url}, retrying after ${retryAfter}s`);
        return true;
      },
    },
  }) as Octokit;
};
