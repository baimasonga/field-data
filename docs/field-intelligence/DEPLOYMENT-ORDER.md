# Production publishing order

This repository has two publishing paths: Cloudflare Workers Builds runs for the
commit, while Deploy Field Data applies the explicit release ID, configured feature
flags and existing secrets, then verifies production. They can overlap even though
GitHub deployments themselves use a concurrency group. The final custom-domain
check must observe this workflow's exact commit/run/attempt marker.

Deploy Field Data now waits for the matching automatic Workers Builds check on the
exact commit to reach a terminal state before deploying. It checks the Cloudflare
app identity and field-data worker name, waits for pending registration and all
matching builds, follows pagination and fails closed if status/read access cannot
be confirmed within twenty minutes. Cloudflare can publish a terminal result in a newer check run while leaving an
older in-progress check unchanged. The guard groups only checks for the same
external Cloudflare build ID and uses the latest check-run ID; distinct active
builds still block publishing. An automatic-build failure is terminal: this
workflow can still perform its independently validated deployment. Unrelated checks
never unblock it. GitHub's existing workflow token needs only checks:read in addition
to contents:read; no new user credential is required.

This guard relies on the installed Cloudflare integration reporting its check. If
the integration or worker name changes, update the guard explicitly; missing checks
stop production publication rather than pretending the competing publisher finished.
It serializes normal publishing for this commit. An operator deliberately retrying
an older automatic build later can still publish over a newer release, and requires
separate operational control.

The existing health, login, critical-path, custom-domain asset/build and offline
signature checks remain mandatory. Offline verification errors now identify the
method and controlled request path, while omitting credentials, query strings and
response bodies. Readiness retries remain limited to idempotent GET/DELETE requests;
POST creation is never retried automatically. Fixture creation/cleanup is unchanged.

Validation includes registration delay, queued/in-progress states, multiple builds,
pagination, terminal failure, unrelated publishers/commits, API failure, timeout and
incomplete pagination. Guard tests are enforced in the feature-capability CI job.
