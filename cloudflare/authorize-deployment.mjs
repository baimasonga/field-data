// Every Wrangler deployment runs this repository's custom build hook, including
// Cloudflare Workers Builds. Only the serialized GitHub workflow may publish.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const authorizeDeployment = (env) => {
  // package.json sets this only together with Wrangler's --dry-run option.
  // This is an operational guard, not a substitute for Cloudflare permissions.
  if (env.FIELD_DATA_DEPLOY_DRY_RUN === 'true') return 'validation';
  if (env.FIELD_DATA_PUBLISH_AUTHORITY !== 'github-actions' || env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_WORKFLOW !== 'Deploy Field Data' || env.GITHUB_REPOSITORY !== 'baimasonga/field-data' ||
    env.GITHUB_REF !== 'refs/heads/main' || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''))
    throw new Error('Production publishing is restricted to the serialized Deploy Field Data workflow on main. Configure Cloudflare Workers Builds for validation only, or disable its automatic deployments.');
  return 'publication';
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Field Data ${authorizeDeployment(process.env)} authorized.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
