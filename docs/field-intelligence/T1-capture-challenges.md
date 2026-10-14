# T1: capture challenges and exact-image replay checks

The companion fieldwork page offers an optional camera workflow for a missing
image attachment on the collector's own synced, unedited submission. The collector
requests a challenge, writes its eight-character code on paper beside the subject,
opens the camera, and captures a JPEG. Adding it to the foreground queue does not
upload automatically. The user explicitly uploads/resumes before the 20-minute
challenge window ends. Cameras open only on user action, request no audio, and
stop on capture, close, cancel, backgrounding, disconnect or unmount. Delayed
permission responses cannot restore a camera after close/disconnect. Canvas output
is limited to 1920 pixels on its longest side and 5 MiB. No code is digitally
overlaid on the photo by the application.

A 256-bit server nonce binds the issuing actor, project, current submission root
and exact expected filename. UUID issuance retries replay the same nonce, and the
collector can recover an issued challenge after reload. One issued challenge per
target is allowed. Server time enforces the deadline. Expired issuance is retired
at the next creation, and cancelled records older than 24 hours are pruned there.
Bound records remain as an exact-fingerprint replay registry. Limits are 20 issued
and 100 issued within 24 hours per actor; 1,000 issued and 10,000 issued within
24 hours globally. Cancellation cannot reset the daily counter. Rollback preserves
nonempty challenge tables. Actor/project/source hard deletion cascades records,
so replay detection is limited to retained records within the same project.

The existing R2 upload manifest accepts optional challengeId and challengeNonce
only together, for image/jpeg or image/png up to 5 MiB. Completion verifies chunks,
whole-file SHA-256 and actual stored bytes as before. In the same transaction it
rechecks live collection grants and source/attachment scope, locks and consumes the
matching challenge, checks the declared image's format signature, rejects a SHA-256
already bound to another retained challenge in that project, links the native
attachment, and records capture plus attachment audits. A failed, expired, wrong
nonce, changed-source, cancelled or reused-image bind leaves no native attachment
link. Completed upload retries are idempotent and add no second binding. Ordinary
native and companion uploads without a challenge remain supported and receive no
challenge record. The nonce grants no upload permission by itself. Audit details
omit the raw nonce.

The submission detail page lists challenges for the current submission definition,
with the visible code, issued/expiry/link timestamps, bound fingerprint and whether
the bound blob is still referenced by the current attachment. A manager replacement
removes that current-reference indication. Read access uses submission.read; deleted
or inaccessible submissions are unavailable. Reviewer responses omit the full nonce
and use private/no-store caching. Panel failures have independent retry controls.

**Interpretation:** status bound means an authorized client linked the server
challenge to stored bytes before expiry. T1 alone marks scene review not-assessed; [T2](T2-human-capture-assessments.md) adds explicit human assessment and outdated status.
A human must open the original image and assess the paper code and scene. The
server does not read that code from pixels, certify a live camera/device, infer
location, or verify capture time. An authorized custom client can submit selected
or synthetic bytes. Format signature checks do not fully decode images. Exact
replay checks cover previously challenged bytes in this project, not all historic
native media, visually similar images, transformed crops, or cross-project reuse.
No fraud score or proof-of-presence badge is produced.

Signed web User statements are available in [T3](T3-signed-capture-witnesses.md),
and optional browser location context in [T4](T4-device-reported-capture-location.md).
Certified witness identity, hardware attestation, stronger sensor corroboration,
visual similarity checks, challenge-aware offline media packages and real
Android/Collect camera acceptance remain pending. Encrypted R3 packages do not preserve challenge metadata;
this initial challenge camera workflow requires connectivity and tab memory.

Validation includes binding and audit idempotency, ownership and reviewer scoping,
nonce/target/expiry/header rejection, revoked grants, closed forms, changed roots,
quota retention, concurrent competing issuance and fingerprint acceptance, native
attachment replacement, camera JPEG bytes/nonce propagation, consent and denied
permission, delayed camera cancellation, challenge recovery/cancel, reviewer retry,
320px layout and ordinary resumable/native attachment regression.
