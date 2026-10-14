# O15: deployment signing readiness and custom-domain verification

The production deployment prepares missing offline signing settings using its
existing Cloudflare access. It reads secret binding names only. An existing key
or origin is not replaced automatically; explicit valid repository settings
still take precedence. Missing keys use a new P-256 PKCS#8 private key, and the
default audience is `https://fielddata.quantixsl.com`.

Generated settings go into a mode-0600 temporary file and are merged into the
existing atomic Worker deployment secret file. The preparer performs no remote
writes. This avoids creating intermediate Worker versions and preserves the
current deployment until the code and settings are uploaded together. Temporary
files are removed on exit; private values are never logged or put in command
arguments. Keys persist as Worker secret bindings, independent of the blocked
GitHub secret-settings API. Invalid explicit key/origin settings stop preparation.

A public `/field-data-build.json` response exposes only the deployment ID with
`Cache-Control: no-store`. After ordinary health/login checks, the release
verifier checks the custom-domain deployment ID and compares its entry JS/CSS
asset paths with the Worker origin. It sends no credentials and creates no
fixture until these checks pass. The user-facing site can therefore no longer
silently pass verification while the Worker URL alone serves the new build.

The verifier creates its own uniquely named empty project and App User,
requests a signed version-2 snapshot, and checks P-256 signature/key fingerprint,
audience, actor/project identity, empty scopes and eight-hour expiry. It rejects
private-key material in a public response. Confirmed fixture IDs are removed on
success or failure; unknown IDs are never deleted. Cleanup failures are reported
for inspection. No existing submissions, projects, actors or assignments are
used or changed. The standard smoke-test administrator session is reused and
closed by the existing finalizer. Fixture creation/deletion leaves audit history.

Tests cover missing/existing/explicit settings, malformed credentials/origins,
sanitized failures, wrong deployments/assets preventing authenticated requests,
valid/disabled/wrong-audience snapshots and cleanup. Worker tests cover the public
release identity without booting a container. All Cloudflare tests run in CI.

This extension does not rotate existing keys or repair an unknown invalid
binding. Live readiness must pass after deployment; a custom-domain routing,
signing or cleanup failure is reported rather than treated as a successful
release. Browser page preparation remains independent from snapshot signing.
