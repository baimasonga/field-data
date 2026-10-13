# O11: optional road-aware backcheck stop order

Managers can request a road-aware suggestion from the approved OSRM service.
The fixed depot is first and the itinerary returns to it. Only coordinates
are transmitted. No default public service is contacted. The existing source
integrity, current-claim, project/form permission and collector eligibility
checks run before either routing method.

The OSRM trip adapter validates a single complete permutation, with the depot
at index zero and each stop present exactly once. Leg distances and durations
correspond to that returned order. The UI and CSV identify the requested and
applied methods. This is a heuristic suggestion, not a guarantee of optimality,
navigation instructions or dispatch. Traffic, road access and safety still
require review. Shift and visit-budget checks remain in effect.

If the provider is disabled, unreachable, times out or returns malformed data,
the straight-line ordering remains visible with an explicit fallback warning.
Driving time and feasibility remain unknown. The adapter caps requests at 98
stops so a return-route request stays within the usual 100-coordinate OSRM
limit. Larger source previews retain their stops and report unavailable road
estimates instead of dropping work. Payload limits, redirect rejection and
five-second deadlines apply to both methods.

Unit tests cover complete and malformed permutations, request privacy,
fixed-depot semantics, bounds and straight-line measurements in a supplied
order. Database tests verify reordered pinned claims, rejected query options
and provider fallback with unknown travel time. Browser tests cover the
method selector, success/fallback messages and mobile width.

Live road coverage and timing acceptance require a configured approved service
and field measurements. Persisted reviewed dispatch and turn-by-turn navigation
remain separate work.
