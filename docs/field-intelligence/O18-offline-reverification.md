# O18: offline re-verification visit instructions

Version-3 signed assignment snapshots include up to 50 assigned re-verification
visits: task reference, asset label/type, fact to check, supervisor instruction,
form, planned UTC date, deadline and availability at issuance. Source answers,
observation history, claim IDs and other collectors' tasks are not included.
The live inbox and snapshot issuer use the same permission-filtered query;
reassigned, cancelled, deleted-form and revoked-access tasks are omitted, as are
visits in archived projects. Ordering retains the newest dispatched visits.

The eight-hour snapshot remains read-only, bound to the collector/project/site,
and encrypted with the separate device passphrase. Offline views cannot check
later cancellation, reassignment, access changes or current collection availability.
They cannot acknowledge a request, close a visit or submit a decision. Reconnect
before acting on changed instructions. The prepared public page remains a
separate prerequisite for offline reload.

Snapshots retain the 256 KiB signed-payload limit. Existing backcheck instructions
are retained; lowest-priority itinerary dates are removed first, then visits are
removed from the end until the bundle fits. Omission counts and incomplete flags
are displayed. The query computes the total after permission filtering without
exposing omitted visit details. Browser validation rejects malformed dates,
identifiers, fields, duplicate tasks, impossible counts and unexpected source
fields before writing the encrypted vault. Labels/instructions render as text.
Versions 1 and 2 remain readable and explain that re-verification was not included.

Validation covers signed API issuance, collector isolation, reassignment,
cancellation, permission revocation, row/byte limits, offline reload/unlock,
absence of plaintext instructions in storage and malformed signed visit rejection.
No Android client changes are introduced. ODK Collect device acceptance, resumable
uploads, relays and unified routes remain pending.
