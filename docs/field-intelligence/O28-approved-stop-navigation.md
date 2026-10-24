# O28: navigation handoff for currently approved field stops

In connected **Fieldwork → Approved itineraries**, each stop has **Check stop
for navigation**. After an online assignment check, the field user chooses
**Directions in Google Maps** or **View location on OpenStreetMap**. Preparing
links sends nothing to either provider. Opening one shares the destination
coordinates with that provider; no App User key, task question, asset name,
project name, instance ID or other Field Data metadata is placed in its URL.
Links use HTTPS, a new tab and no opener/referrer access.

This is a per-stop provider handoff, not built-in turn-by-turn navigation or a
promise that provider routes match the approved plan. Origin/travel mode are
chosen by the user/provider. OpenStreetMap is a destination pin, not a routing
instruction. Road access, current conditions and real-device/provider acceptance
remain separate checks. Location comes from the approved stop snapshot; device
GPS accuracy remains visible and is not a proof of presence.

## Current authorization and stale work

`GET /field-data/app-user/itineraries/:itineraryId/stops/:kind/:stopId/navigation`
accepts an active App User bearer key, not an administrator session. It reuses
the current approved-itinerary reader for the key's project and actor. Only the
latest approved plan for a date within the existing retention window can provide
links. Both backcheck and re-verification stops are supported.

The current reader rechecks task assignment/status, open response form and form
assignment, source provenance/integrity, current claim/version, re-verification
revision/observation, active project and source availability. Cancelled, linked,
closed, reassigned, superseded, permission-revoked or otherwise withheld stops
return not found. Cross-actor/project requests disclose no stop; invalid kinds
or IDs and unavailable/invalid coordinates also return not found. No caller
coordinate or provider URL can override the approved destination. No visit is
completed or acknowledged and no itinerary/order is changed by this read.

Successful responses are private/no-store and include task/plan identity,
checked time, a 60-second lifetime, validated destination/accuracy and two fixed
provider targets. Zero/null-island, nonfinite, out-of-range and nonnumeric
coordinates are rejected. Unknown/negative accuracy is reported as unknown.

The browser validates HTTPS provider hosts and credentials, hides old links on
retry/error, and clears links after their short lifetime. Expiry uses a local
monotonic timer with the full request duration deducted, so a slow check cannot
extend the lifetime and device wall-clock offset does not affect it. Clicking
an expired link is blocked even if a timer callback was delayed. Refresh,
disconnect, access failure and removed stops clear their component state.
A successful check is point-in-time authorization; a later revocation cannot
recall coordinates already viewed or shared with a provider.

## Offline scope and validation

Saved signed/encrypted itineraries retain their existing coordinates and
instructions, but do not acquire navigation authorization or provider links.
The saved view directs the user to connected Fieldwork for a current check.
No map-provider URL is added to offline bundles or private persistent storage.

Unit tests cover fixed destination-only URLs, lifetime, credential/text exclusion
and coordinate limits. PostgreSQL tests cover authorized destinations, wrong
actors/admin sessions, bad IDs, cancelled stops, broken provenance, archival,
newer approvals, revoked form access and mixed task kinds/stale revisions.
Browser tests cover no automatic provider handoff, check failure/retry, bearer
scope, safe links, expiry, invalid host rejection, disconnect cleanup, mobile
layout and absence of provider controls on offline snapshots.

No database migration or external API credentials are needed. Built-in/offline
routing, multi-stop provider exports, additional task types and field acceptance
remain separate work. Operations and all eight areas remain partial.
