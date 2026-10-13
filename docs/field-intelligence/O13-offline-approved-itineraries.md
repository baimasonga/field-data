# O13: signed and encrypted offline approved itineraries

The companion snapshot can now carry approved stop orders and locations beside
assigned instructions. Issuance uses the same collector isolation, current-claim,
stored-byte integrity, pending-task and response-permission checks as the live
itinerary endpoint. Existing source answers and submission IDs remain withheld.

The signed `offline-assignments@2` payload adds itineraries. The browser still
accepts prior version-1 assignment-only snapshots. Version-2 route dates,
coordinates, stop positions/IDs, sizes and omission counts are validated before
saving or unlocking. A valid signature cannot make malformed route data valid.
Origin, actor/project identity, signing-key fingerprint and eight-hour expiry
retain the existing checks. The encrypted vault keeps coordinates and instructions
out of plaintext browser storage; lock/disconnect removes the decrypted view.

At most five whole itinerary dates and 100 located stops are included, preferring
today and upcoming dates before history. Plans are never split to fit a limit.
Omitted dates and stops already withheld at issuance are shown explicitly. The
existing 256 KiB signed-payload limit also applies; lowest-priority whole
plans are omitted if needed to leave room for the assignment instructions. No automatic route downloads
or external navigation requests are added.

Offline copies cannot discover subsequent cancellations, changed permissions,
source edits or road conditions. The page explicitly labels this limitation
and the issue/expiry times; a live inbox refresh removes the older saved snapshot.
The page shell must be loaded before going offline and is not cached. An expired
snapshot must be refreshed online; this does not provide a multi-day standalone
Collect client, turn-by-turn navigation, background relay or resumable uploads.

Tests verify bounded whole-plan selection, signed version compatibility,
collector-scoped issued routes, encrypted persistence, offline unlock, malformed
signed coordinates, mobile width and clearing the unlocked route on lock.
