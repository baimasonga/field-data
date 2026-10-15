# Latest-work review fixes

- **Survey revision:** a dedicated conditional POST to the form's `/versions`
  endpoint locks the form, verifies the published SHA-256 and absence of a draft,
  compiles and publishes in one transaction. Normal draft writes/publication take
  the same form lock. Existing drafts and their submissions are preserved; a
  failed publication rolls back its new draft. Old servers return 404, with no
  fallback to the unsafe two-request installer protocol.
- **Capture recovery:** live issued challenges precede completed history within
  the 20-item recovery cap. A real API regression case completes 20 later photos
  and still recovers/cancels the older live challenge.
- **Publishing:** the Wrangler custom build hook accepts publication only from
  the serialized GitHub production workflow. Independent automatic Cloudflare
  deploys cannot publish competing commits. Configure those builds for validation
  only or disable automatic deployment; until then their deploy check is blocked
  intentionally. Historical commits predating the hook need operational controls.

Validation: 39 PostgreSQL API regression checks, 15 XLSForm pipeline checks
(including real PyXForm and strict ODK Validate), and 19 Node unit checks passed.
The API coverage includes concurrent revision attempts, a concurrent normal draft
editor, existing draft-submission preservation and rollback after a database
publication failure. Server lint and whitespace checks passed.

Wrangler bundled the Worker with a temporary prebuilt-container reference for
local dry-run validation. The actual Wrangler hook also rejected an unapproved
automatic deployment context. Full container-image validation remains with CI;
this workspace's default Docker buildx configuration is read-only.

An exploratory legacy draft test expects an Enketo service request, while this
repository's existing native Web Forms implementation generates its form IDs
locally. That expectation still fails and was not disabled or changed. The native
XLSForm/publication pipeline passes. No real-device acceptance is claimed.
