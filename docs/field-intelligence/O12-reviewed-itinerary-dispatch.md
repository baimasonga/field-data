# O12: reviewed itinerary dispatch to the companion inbox

A manager previews eligible dated backchecks, enters dispatch instructions,
explicitly reviews warnings/access/time assumptions, then approves the shown
itinerary. The server recomputes its fingerprint under the project allocation
lock. Changed tasks, locations, quotas, shift availability, collector eligibility
or stop-order method reject an old preview. Closed/ended shifts, empty plans,
archived projects and truncated plans cannot be dispatched. Remaining warnings
are visible for the manager to review; approval does not assert safe access,
feasibility, navigation correctness or completion.

The saved snapshot is immutable and audited. Stable request UUIDs make retries
idempotent; changed request contents cannot reuse an ID. Approval never
reschedules, changes or completes a backcheck. Optional road ordering is still
operator configured; road failure is preserved as unknown travel time.

The App User endpoint returns only that active collector's latest approved
itinerary per date, bounded to 30 dates between seven days ago and 90 days ahead
in UTC. Every stop is rechecked for assignment, planned date, pending status,
current claim, active case/forms, response collection rights, unencrypted source
and stored-byte integrity before coordinates are returned. Unavailable stops
are withheld with an explicit count. Original answers, source submission IDs
and claim IDs are not exposed. Displayed stop numbers retain their approved
positions, so a withheld visit leaves a gap rather than silently rewriting the
approved order. Disconnect clears locations from memory.

The companion page loads itineraries independently from tasks, re-verification
and receipts. Failures clear the previously shown routes and provide a retry
message through Refresh. Content is escaped and credentials remain only in tab
memory. Live itineraries require an online refresh. The [O13 extension](O13-offline-approved-itineraries.md)
adds signed offline copies; locations are not added to browser push payloads. Turn-by-turn navigation,
accessibility observations, overnight shifts and other task types remain pending.

Validation covers stale previews, idempotency and changed retry contents,
manager/App User separation, collector isolation, cancellation and revoked
collection rights. Browser workflows cover explicit review, preserving the
preview query, escaped dispatch text and clearing coordinates on disconnect.
