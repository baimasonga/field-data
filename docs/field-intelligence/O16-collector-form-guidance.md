# O16: collection guidance on approved itinerary stops

Each approved stop now identifies its current response form, published version
and deadline alongside the question, location and GPS accuracy. This can differ
from the original source form: a backcheck collected against a housing survey
may need an independent verification form. The original source submission and
claim identifiers remain withheld from the collector.

The live endpoint derives form metadata only after assignment, current-claim,
source integrity, active case/form and collection-permission checks. A missing
current response definition withholds the stop. Signed offline copies retain
this metadata as saved, rather than claiming it is still current. Older snapshots
without form metadata still unlock and show a request-matching instruction.
The browser rejects malformed optional form/version/deadline fields in signed
payloads before saving or unlocking.

The shared online/offline stop component presents readable labels and exact
source-zone deadline times. Technical request UUIDs are available in a collapsed
reference, and unknown/negative GPS accuracy is shown as Unknown. Current versus
saved form versions are explicit. This does not open credential-bearing browser
URLs, download a form, submit a response or claim that a visit is complete.

Database tests verify the chosen response form differs from the source form and
that signed snapshots carry the same scoped metadata. Browser tests verify live
and offline form/version display, 320px layout, escaped instructions and clearing
locations on lock/disconnect. ODK Collect must still have the indicated form;
real-device acceptance remains separate from these browser fixtures.
