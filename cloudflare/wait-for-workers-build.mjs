// Wait for the automatic publishing path before the authoritative deployment.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const waitForWorkersBuild = async ({ repository, commit, token, fetcher = fetch,
  pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms)), now = Date.now, timeoutMs = 20 * 60000 }) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[0-9a-f]{40}$/.test(commit ?? '') || !token) throw new Error('Build ordering requires the repository, exact commit and GitHub read access.');
  const deadline = now() + timeoutMs;
  for (;;) {
    const builds = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetcher(`https://api.github.com/repos/${repository}/commits/${commit}/check-runs?filter=all&per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'field-data-deployment-guard' }, signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`Cannot confirm automatic build status (GitHub HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data.check_runs)) throw new Error('Invalid GitHub check-run response.');
      for (const check of data.check_runs) {
        if (check.app?.slug === 'cloudflare-workers-and-pages' && check.name === 'Workers Builds: field-data' && check.head_sha === commit) builds.push(check);
      }
      const more = response.headers.get('link')?.includes('rel="next"');
      if (!more) break;
      if (page === 10) throw new Error('Cannot confirm build status: check-run pagination limit reached.');
    }
    // Cloudflare reports a terminal status in a new check run for the same
    // external build ID. Its older in-progress check can remain unchanged.
    // Collapse only the same build, never independent active publishers.
    const latest = new Map();
    for (const build of builds) {
      if (!Number.isSafeInteger(build.id) || build.id < 1) throw new Error('Invalid automatic build check identity.');
      const identity = typeof build.external_id === 'string' && build.external_id ? `build:${build.external_id}` : `check:${build.id}`;
      if (!latest.has(identity) || build.id >= latest.get(identity).id) latest.set(identity, build);
    }
    if (latest.size > 0 && [...latest.values()].every(build => build.status === 'completed')) return { completed: latest.size };
    if (now() >= deadline) throw new Error('Automatic Cloudflare build did not reach a confirmed terminal state. Deployment stopped to avoid competing publishers.');
    await pause(10000);
  }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await waitForWorkersBuild({ repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, token: process.env.GH_TOKEN });
    console.log(`Automatic Cloudflare builds finished (${result.completed}); the verified deployment can proceed.`);
  } catch { console.error('Automatic Cloudflare build completion could not be confirmed. Deployment stopped; inspect the commit checks and GitHub read access.'); process.exitCode = 1; }
}
