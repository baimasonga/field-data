# M1: reviewed photo text and voice transcription

This bounded Multimodal slice extracts visible text from PNG/JPEG photos and
transcribes WAV/MP3 audio attached to received, unencrypted submissions. It does
not infer asset identities, fill form fields, alter answers or review decisions,
translate speech, certify truth, or establish calibrated model quality.

## Contract

`GET .../submissions/:instanceId/media-extractions` returns eligible current media,
up to 20 extraction records (including historical versions), their review history,
provider readiness and current permission controls. `POST` accepts exactly
`{requestId, name, allowExternalProcessing:true}`. A web User with current
submission.read/update rights explicitly authorizes sending only that file's bytes
to OpenAI. App Users cannot request or review. The operator must set
FIELD_DATA_EXTRACTION_ENABLED=true and FIELD_DATA_OPENAI_API_KEY. Photo/audio model
names default to gpt-4.1-mini and gpt-4o-mini-transcribe and can be configured by
FIELD_DATA_EXTRACTION_PHOTO_MODEL / FIELD_DATA_EXTRACTION_AUDIO_MODEL. The deployment workflow passes the enable/model
repository variables and FIELD_DATA_OPENAI_API_KEY repository secret into the Worker
and server container; absent settings leave extraction off. No client
supplied URL, model, prompt or credential is accepted. Original filenames, answers,
account names and locations are not added to the provider request. Media may itself
contain personal data. Provider privacy/retention terms require operator acceptance.

Requests bind the original submission definition, filename, blob, SHA-256, kind,
model, authenticated actor and consent timestamp. Up to 20 attempts per submission
across versions are retained. Files are limited to 5 MiB; formats are checked from
both MIME and magic bytes. Output is limited to 12,000 characters, without a
confidence score. The provider has a 45-second deadline, bounded response bytes,
no redirects and no automatic retry. Empty, incomplete, malformed and oversized
answers fail explicitly, with no provider body or credential in the response/audit.

A short transaction reserves a processing record before the external call; identical
retries never resend media. Concurrent requests serialize on the source submission.
A second transaction rechecks permissions and source access before storing output.
An interrupted call remains outcome-unknown, displayed as interrupted after two
minutes; the same request is never automatically sent again. A new attempt needs
a new explicit request and may incur provider cost. There is no background job.

`POST .../media-extractions/:extractionId/reviews` accepts exactly
`{requestId, revision, action, text, reason, reviewedOriginal:true}`.
Action is approve or reject; approval requires 1–12,000 trimmed characters and
rejection requires null text. A reason of 10–2,000 characters is required. A new
review may correct or supersede the preceding decision, up to 20 reviews. Revision
checks prevent lost edits; identical retries return current history. The original
model output and every review remain immutable. Only the latest decision for an
unchanged, current media binding can be approved for current use. Historical
approval becomes outdated after attachment replacement/submission supersession;
new approval requires a fresh extraction. Historical rejection is allowed.

An authenticated source download checks original bytes against the recorded hash,
works for historical records and logs access. Blob garbage collection retains
these originals until the existing source purge removes their extraction records.
Append-only guards allow existing actor anonymization and source cascade purges.
Rollback preserves nonempty extraction/history tables. Audit contains IDs, model,
action and fingerprint, never extracted/reviewed text or provider errors.

## Review workflow and acceptance

Submission details → Media extraction lists current eligible media and historical
attempts. Reviewers explicitly download the original before attesting to review,
compare proposed output, correct it, then approve or reject with a reason. Viewers
can inspect output and history but receive no write controls. Lost responses keep
the same retry identity; refresh retrieves persisted state. JSON export includes
source fingerprint, provider/model, original proposal and review decisions, with
explicit current/outdated status. This is an authenticated provenance export, not
a signed certificate or proof that media/model output is correct.

Validation must cover real PostgreSQL permissions, source changes, concurrency,
safe retries, interruption, quotas, history immutability, rollback and cascade
purge; provider wire-format/limits/failure fixtures; and browser correction,
approval/rejection, viewer permissions, stale state and narrow-screen flows.
Fixture success is not live provider acceptance or local-language evaluation.
Live OpenAI configuration, consent/retention acceptance, photo/voice accuracy,
labelled language evaluation, device capture and offline models remain pending.
