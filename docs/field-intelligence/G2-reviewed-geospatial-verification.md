# G2: reviewed geospatial verification

This slice lets a web reviewer compare a submission's reported location and visit
basis with dated imagery references. It records supports, conflicts, unclear or
unavailable assessments. It does not download/interpret satellite imagery, detect
change, prove presence or automatically alter answers, findings or review cases.

## Sources and uncertainty

The source snapshot binds the current submission definition/version, SHA-256 of
stored XML and ordered attachment metadata (name, blob identity/hash and audit
flag), first geopoint field in form order, parsed reported location and device
audit start time (server receipt time, explicitly labelled, when absent). Later
XML/attachment/location/time changes make older assessments outdated. Missing
location never becomes a positive or conflicting assessment. Reported accuracy
is not certified positional accuracy, and receipt time is not a visit time.

Reviewers can cite a dated HTTPS imagery reference, or a selected cached Sentinel-2
scene. Catalogue metadata is an availability record for a 0.05-degree cell, not
proof of exact point coverage or what the image shows. Scene dates/cloud cover,
lookup age, date offset and unknowns are displayed. Only 50 nearest candidates
are offered, with omissions named. A catalogue assessment pins the selected
scene's canonical metadata fingerprint; changed/missing scene metadata, changed
catalogue configuration or incomplete cache makes it outdated. Refreshing an
identical catalogue result alone does not invalidate it. Manually supplied image
references and dates are reviewer assertions: their contents/availability are not
monitored or archived. No imagery pixels are fetched or proxied by this feature.

Supports/conflicts require an accessible reported location, an HTTPS image
reference and attestation that the reviewer inspected the image. Unclear may cite
catalogue metadata without an image, or use no citation; unavailable uses no
citation. Every outcome requires a claim, reasoning and explicit limitations
(season, viewpoint, cloud, image date/resolution, reported position or time).
A subsequent assessment supersedes the prior effective decision but never rewrites
its history. Older current-source records are still history, not competing votes.

## API and permissions

`GET .../submissions/:instanceId/geo-assessments` returns current source/context,
provider/cache readiness, candidates, up to 50 historical assessments and revision.
Current read permission applies; viewers inspect history, only web Users with
current submission.read/update can write. App Users cannot assess or check.
Encrypted submissions are not interpreted and have no write controls. Archived
projects allow history only. Source deletion/revoked access uses existing 404 scope.

`POST .../geo-assessments` accepts exactly `{requestId, revision,
sourceFingerprint, outcome, claim, reason, limitations, citation, reviewedImage}`.
Claim/reason/limitations are each trimmed 10–2,000 characters. Revision is the
submission-wide count, including earlier versions, bounded at 50. Citation is
null; `{kind:'reference', title, url, date:'YYYY-MM-DD'}`; or
`{kind:'catalogue', sceneId, sceneFingerprint, url}` (url may be null for an unclear
metadata-only assessment). Supports/conflicts require reviewedImage=true and URL.
Arbitrary schemes, URL credentials, unknown fields and malformed dates are rejected.
Manual image dates cannot be future dates.
URLs must be nonsecret references; external navigation is explicit with no referrer.
No caller-supplied URL is fetched on the server.

Writes lock live read/update grants, actor, source and attachments in native upload
order, then selected cache metadata. Concurrent revision checks prevent lost
changes. Identical normalized request retries do not append history and can replay
after source changes or later assessments. Changed retry content conflicts.
Record and audit commit atomically; audit omits text, links and coordinates.

`POST .../geo-assessments/catalogue/check` accepts exactly `{sourceFingerprint}`.
It is off unless FIELD_DATA_IMAGERY_ENABLED=true, uses the existing configured
STAC catalogue/collection, sends only cell centre/whole-day window, and has the
existing 15-second/ten-page bounds. It checks only this source, rechecks permissions
and source after the network response, caches only complete successful answers,
and never automatically retries. A failure is shown without fabricating no scenes.
Existing cached metadata and manual references work with provider checks off.

## History, export and acceptance

Submission details → Geospatial verification shows source location/accuracy,
reported or receipt time, catalogue metadata, dated references, effective latest
assessment and full history. Download includes immutable source/citation snapshots,
reviewer/time/reasons and current/outdated/superseded state. It is an authenticated
provenance export, not a signed certificate or truth/imagery-completeness proof.
Existing Central version XML remains the source citation; historical attachment
bytes are not newly retained by G2. Append-only database guards allow existing
actor foreign-key clearing and source cascade purge. Rollback retains nonempty
history; no core columns are changed.

Acceptance requires real PostgreSQL source/permission/retry/concurrency/quota tests,
immutable history and rollback/purge; provider request privacy/failure fixtures;
browser cited review/revision, lost response, viewer, outdated state and mobile
flows; passing CI/deployment checks. Live catalogue/image inspection, labelled
change-detection evaluation, exact footprint intersection, cloud masking, automated
change candidates and real-device acceptance remain pending.
