# O10: persisted UTC shift windows and visit-time planning

Collectors can retain seven optional UTC shift windows and an expected visit
allowance (1–480 whole minutes). Each window is either unavailable (`null`)
or `{ start: 'HH:mm', end: 'HH:mm' }`, ending after it starts on the same UTC
date. Overnight shifts are not represented by this contract. Existing
calendars without windows retain their date/quota behavior.

Dated exceptions retain date/maxVisits and can override a weekday with a
custom window or null/unavailable. Omitting the exception window inherits the
weekday. All existing quotas, independence, pending-work limits, permissions,
project locks and reservation accounting remain in effect.

Calendar-aware automatic allocation skips closed/ended windows and dates
that cannot fit another configured visit allowance before the actual due
instant. Every requested or completed dated visit counts against the day.
The clock check conservatively charges all those reservations against the
remaining window, including completed ones; it may under-allocate late in a
day but cannot claim that unknown travel is feasible. This is a minimum
visit-time bound, not routing, optimality or observed working time.

Itinerary preview uses saved visit duration and remaining shift minutes when
preview parameters are omitted. Future windows use their full duration;
current windows use minutes remaining at request time; ended windows have a
zero budget. Preview overrides cannot increase the available shift budget.
Closed/ended shifts require review, and existing visits never move when a
calendar is edited. Driving time, unavailable routing, excluded points,
GPS uncertainty and over-budget warnings retain their existing behavior.
The UI offers saved assumptions or explicit preview overrides; CSV includes
shift boundaries and warning states.

## Production routing configuration

Optional `FIELD_DATA_OSRM_URL` now passes through the Worker to the Central
container. In GitHub-driven deployment, configure the repository/environment
variable of that name; the workflow injects it without printing its value.
For local Central, set it on the server process. There is no public default.
The O9 adapter still rejects credential-bearing URLs and redirects, and
bounds outbound requests. Live regional coverage and timing acceptance remain
pending until an approved service and field measurements are available.

## Validation

Tests cover clock formats, invalid/overnight windows, exception precedence,
closed and expired shifts, remaining minutes, deadline boundaries, legacy
calendars, persisted settings, allocation limits, unchanged existing visits,
preview budget clamping, browser editing/invalid-window recovery and 390px
layout. Production configuration forwarding is covered by Worker tests.
