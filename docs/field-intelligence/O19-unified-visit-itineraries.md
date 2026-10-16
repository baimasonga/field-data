# O19: unified backcheck and re-verification itineraries

Managers can preview and approve one collector's dated backchecks and dispatched
re-verification visits together. The existing route and itinerary endpoints are
retained. Preview responses identify `scope: combined-visits@1` and stops carry
`kind: backcheck` or `reverification`. Legacy approved stops without a kind remain
backchecks. The planning table, CSV and collector view identify the visit type.

Re-verification coordinates come from the exact claim attached to the task's
observation. The source must be current, readable, unencrypted, within the XML
size bound and match both provenance and observation hashes. The asset's current
owner and form, collector assignment and open collection form are checked.
Missing or uncertain GPS, inaccessible sources and unavailable work are reported
using the existing exclusion and review warnings. No asset name is sent to the
road provider: it receives coordinates only.

Both kinds share the existing 100-candidate route bound, deterministic nearest
stop ordering, optional operator-controlled OSRM road ordering, return leg and
UTC shift budget. Truncation is calculated across both kinds and prevents
approval. Undated work from both kinds is counted but cannot be routed. Visit
time conservatively includes all dated reservations, including completed visits;
travel estimates cover located pending stops only. Excluded or truncated work
therefore still requires manager review. Stops at the same location remain
separate assignments and retain separate visit time.

Approval pins task revision, observation, claim, current asset ownership,
instructions, stop order and calendar/timing assumptions. A changed preview or
timing override requires renewed review. Identical approval retries retain the
existing immutable snapshot. On collector refresh, re-verification stops are
withheld if cancelled, closed, reassigned, rescheduled, revised, moved to another
asset, no longer collectible or no longer supported by verified source evidence.
A new manager preview/approval is needed to deliver changed instructions.

The signed encrypted offline itinerary carries the same visit kinds and recheck
instructions. Snapshot validation accepts only the two known kinds (and legacy
missing kinds). Offline views remain read-only and cannot learn of subsequent
cancellations or permission changes until reconnecting. Existing snapshot expiry,
identity, encryption and omission limits apply; no database migration is needed.

Validation covers mixed preview and road legs/time, combined truncation, stale
approval and timing changes, scoped collector delivery, evidence tampering,
revised instructions, cancellation, revoked form assignment and signed snapshots.
Browser coverage includes visit labels in manager/collector views and CSV, and
encrypted offline display at mobile widths.

This does not provide turn-by-turn navigation, automatic rescheduling, overnight
shifts, additional task types, a live-provider acceptance result or real-device
Collect acceptance. It supersedes the route limitations recorded in O17/O18.
