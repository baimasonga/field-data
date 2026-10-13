# O9: road and visit-time estimates

The manager itinerary preview retains the deterministic nearest-next-stop
straight-line ordering. It can now measure that order using OSRM's driving
route service, including the return to the start. This does not optimize stop
order, navigate, dispatch or reschedule tasks.

## Operator configuration

Set `FIELD_DATA_OSRM_URL` on the Central server process to an approved OSRM
base URL, for example `https://routing.example.org/osrm`. No public default
is used. Recommend a self-hosted OSRM deployment with current regional road
data; enable only after reviewing its coverage and location-data handling.
The provider receives depot and authorized stop coordinates, without task,
submission, project or collector identifiers. Provider access logs may still
contain precise coordinates. Use HTTPS outside a trusted private network.
Credentials in URLs, query strings and fragments are rejected. Redirects are
not followed. Requests have a five-second deadline, a 256 KiB response limit
and at most 100 stops. No new dependency or schema migration is required.

## Contract and interpretation

`GET /v1/projects/:projectId/backcheck-route` accepts optional integer
`visitMinutes` (1–480, default 30) and `dayMinutes` (1–1440, default 480).
These are preview assumptions, not persisted calendar shift hours.

`road.status` is `ok`, `disabled`, `misconfigured`, `tooManyStops`,
`unreachable`, `timeout`, `invalidResponse` or `unavailable`. Successful
results provide road kilometres, driving minutes, each leg including return,
and the largest waypoint snap distance in metres. The existing straight-line
route remains present for comparison. Failed estimates never become zero
travel time: `timing.totalMinutes` and `timing.overBudget` are null.

Total time rounds up driving minutes plus located stops times visit duration.
The preview requires review when routing is unavailable, snaps exceed 100 m,
or the time budget is exceeded, in addition to existing permission, integrity,
capacity and location checks. CSV includes estimate status and time assumptions.
OSRM driving durations exclude live traffic, walking, access delays and visit
variability. Excluded/truncated tasks are not included in the total; warnings
must be resolved before relying on the day's estimate.

## Acceptance

Unit tests cover outbound coordinates, return legs, invalid configuration,
malformed/unreachable responses, oversized bodies and transport failures.
PostgreSQL API tests exercise travel budgets and failure without exposing
upstream errors. Browser tests exercise displayed estimates, access warnings,
CSV and unavailable fallback. Live regional coverage and field travel-time
validation require an operator-configured service and remain pending.
