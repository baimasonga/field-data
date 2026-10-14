# O14: explicit preparation of the public companion page

The companion page offers Prepare offline page and Remove offline page. The
prepared public shell can reopen at `/fieldwork` without a network connection
for up to 24 hours. Assignment and itinerary snapshots are still separately
signed, passphrase encrypted and limited to eight hours. Preparing a page does
not save a token, a passphrase, API responses or task data, and does not grant
notification permission. Removing the public shell leaves encrypted snapshots
and push subscriptions intact; their controls remain separate.

The service worker accepts only the exact public HTML/config/version resources
and a bounded list of loaded same-origin JS/CSS/font assets. It rejects asset
queries, fragments, redirects, private/API URLs and authenticated requests.
Public preparation requests omit cookies and authorization. Assets have
per-response and total byte limits, a request deadline and a 60-asset limit.
A candidate cache is published only after every resource succeeds; failed
preparation leaves an older prepared copy intact. Operations across tabs are
serialized. Changed entry builds require an online reload before preparation.

Normal requests still prefer the network. On a connection failure, only a
matching prepared public resource can be served, and only before expiry with
an unchanged clock direction. A backwards device clock or expired metadata
rejects fallback. No backcheck, receipt, imagery, attachment or other API
response is cached. The existing generic push-notification behavior remains.

The browser workflow uses a real production build and real service worker,
not the notification fixtures. It verifies complete offline reload, encrypted
snapshot unlock without plaintext tasks in Cache Storage, invalid private
asset rejection without losing a prepared page, mobile width, cache removal
and rejecting an expired shell. General fieldwork workflows run alongside it.
The production browser test joins the existing post-build CI workflow; a dev
checkout without a production build skips that production-specific test.

This is preparation for an existing companion page, not a standalone Collect
replacement, background upload queue or multi-day credential cache. Network
reconnection and a fresh signed snapshot are still necessary after expiry.

## Deployment signing configuration

The Worker now forwards optional `FIELD_DATA_OFFLINE_ORIGIN` and
`FIELD_DATA_OFFLINE_SIGNING_KEY` to Central. GitHub deployments accept the
origin as a repository/environment variable and the P-256 PKCS#8 PEM private
key as a repository/environment secret of those names. The origin for the
custom-domain site is `https://fielddata.quantixsl.com`. Empty optional settings
are excluded from the generated secret file so an existing Worker binding is
preserved. The key is never printed. Missing/invalid signing settings leave
snapshot issuance disabled; public page preparation works independently.

Repository secret/variable metadata was inaccessible to the current GitHub
integration (HTTP 403). No signing key was created or rotated, and live signing
configuration has not been verified. These are operator settings, separate
from the implemented and tested forwarding path.

The [O15 readiness extension](O15-signing-readiness.md) prepares absent Worker
bindings through the deployment and verifies an issued snapshot on the custom
domain. It preserves existing keys; the earlier GitHub metadata denial does
not prevent this deployment-managed path.
