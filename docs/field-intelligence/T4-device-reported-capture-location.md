# T4: optional location context for challenged photos

The companion fieldwork camera offers an unchecked option to include one browser
location reading with a challenged photo. Checking it does not request location.
The collector must open the camera and explicitly press **Read location for photo**.
The browser requests a fresh, high-accuracy reading with a ten-second timeout;
there is no continuous watch, background collection or IP-location fallback.
Permission denial, absence, invalid coordinates or stale readings leave photo
capture and upload usable without location.

A reading contains only latitude, longitude, reported accuracy in metres, provider
sample timestamp, photo timestamp and the source label browser-geolocation. The
photo timestamp is taken immediately before drawing its camera frame, rather than
at upload. A reading must be no more than sixty seconds older than that timestamp
and cannot be later. Coordinate/accuracy bounds and exact ISO timestamps are
validated in browser and server. Zero coordinates and zero reported accuracy are
accepted. Accuracy may be as poor as 100 kilometres; this records the provider's
assertion and makes no claim of fitness for verification.

The camera displays coordinates and accuracy before capture. The queue discloses
that explicit upload shares the location with authorized reviewers and supports
removing location before the upload manifest is created. After a manifest has
started, its metadata is immutable: cancel/remove that queued transfer before
restarting without location. Cancel, camera close, backgrounding, disconnect,
unchecking and unmount clear the active reading and invalidate delayed callbacks.
An already queued photo retains its disclosed context until removed or uploaded;
closing the camera or changing the next-photo option does not silently edit it.
No location is written to localStorage or sessionStorage. Reloading loses the
camera/queued context just as it loses the challenged photo's bytes. R3 encrypted
packages do not yet preserve challenge/location metadata.

Resumable manifests may include captureLocation only with a valid image challenge
ID and nonce. Strict validation rejects unknown sensor fields, nonfinite numbers,
out-of-range coordinates/accuracy and invalid/reversed/over-sixty-second sample
intervals. Canonical nested field ordering preserves retry identity across JSONB
serialization. Location changes under an existing upload UUID conflict. The client
checks the complete location context on saved-transfer recovery and every upload
response; changed context cannot be silently resumed or completed.

The same transaction that validates and binds the nonce and exact image SHA-256
copies the optional context to the challenge record. Failed binds leave both the
native attachment and challenge location unset. Byte verification, permissions,
expiry and replacement locks remain enforced. Context survives temporary-transfer
expiry as historical evidence attached to the original challenge. Ordinary uploads
and challenged photos without location continue to work; absence is explicitly
shown and is not a fraud signal. General audit details omit coordinates and sensor
timestamps. The protected upload manifest and challenge APIs necessarily contain
the reading; deployment/operator access to the database is still trusted.

Submission details → Capture challenges displays the coordinates, reported
accuracy and both client timestamps with a clear limitation. Attachment replacement
or submission supersession makes the context historical; it is not presented as
location of the replacement photo. Read access uses submission.read, and collector
recovery remains limited to its own live authorized submission. Deleted/inaccessible
sources remain inaccessible. No external map service receives the reading.

**Interpretation:** the client supplied these values. A custom authorized client
can fabricate them, and browser/OS location can be inaccurate or spoofed. Validation
of a sixty-second interval checks internal consistency of asserted client times;
it does not establish actual freshness, server capture time or GPS authenticity.
Server boundAt remains the separately recorded image-link time. This feature does
not establish physical presence, device identity or sensor corroboration of a field
claim. T3 signatures cover the original photo fingerprint, not a certified location
reading. No fraud score, automatic review decision, geofence verdict or replacement
of the form's survey geometry is introduced.

Hardware-backed sensor attestation, claim-location comparison, movement/heading
corroboration, native Collect integration, challenge-aware offline packages and
real-device/field acceptance remain pending. Browser geolocation requires HTTPS
(or a permitted loopback development origin) and user permission.

Tests exercise actual PostgreSQL binding and immutable retries, optional/absent
context, malformed metadata, privacy/scoping and failed-bind rollback. Browser
coverage checks explicit consent, one request, denial, stale readings, expiry before
capture, late callbacks, removal before upload, altered response rejection, reviewer
history and 320px layout. Existing capture/upload/review and unit checks remain
required in CI.
