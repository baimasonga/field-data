# One production publishing authority

Production publication goes through the GitHub **Deploy Field Data** workflow on
`main`, serialized by its `field-data-production` concurrency group. The Wrangler
custom build hook (`cloudflare/authorize-deployment.mjs`) rejects other publishing
contexts, including Cloudflare Workers Builds. This applies to automatic builds
of the same commit and of different newer commits; waiting on one commit's check
runs cannot provide that guarantee.

The deployment step supplies `FIELD_DATA_PUBLISH_AUTHORITY=github-actions`; the
hook also checks the workflow, repository, branch and GitHub run identity.
`npm run check` supplies a separate dry-run marker together with Wrangler's
`--dry-run`. That marker is not set on publication. This is a guard against
accidental competing publishers, not a security boundary against an operator
who controls the repository or Cloudflare account.

Configure Cloudflare Workers Builds for validation only (`npm run check`) or
disable its automatic production deployments. Until that setting is updated, its
automatic deploy command will fail explicitly at the hook, before publishing;
the GitHub deployment does not depend on that blocked automatic check. Remove
that check from required branch checks if it was previously required. No extra
API token or Cloudflare permission is needed by the guard.

The hook is versioned repository code. A deliberate rollback or manual rerun of
an old commit from before the hook can bypass it; restrict those actions in
Cloudflare and perform supported rollbacks through the current workflow. Before
the first release with this guard, let any already-running old automatic builds
finish; older builds do not contain the new guard.

The existing health, login, critical-path, custom-domain asset/build and offline
signature checks remain mandatory. The guard does not weaken or skip readiness.
Regression checks verify authorized GitHub publication, blocked automatic builds
for different commits, missing identity, non-main branches, dry-run validation,
and actual Wrangler/workflow wiring.
