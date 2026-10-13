# Submission record presentation

Implements the approved desktop/map and mobile inspector direction, with a
matching submission detail layout. Shared interface styling targets legacy
heading spans as well as HTML headings, consistent card borders, focus
states and touch controls throughout the authenticated shell.

## Meaning and interaction

- Record titles remain the actual instance name or identifier. Do not split
  a name heuristically into invented place and record identifiers.
- Review status uses the existing backend state; Received is not Verified.
- Dates show the full date, seconds and source offset/time zone. Unzoned
  timestamps explicitly say that the time zone is unknown.
- Collection timing uses named start/end datetime fields outside repeats,
  with explicit offsets, valid dates and a nonnegative interval. Duration
  describes recorded timestamps, not observed time working in the field.
- GPS accuracy is unknown in the map's WKT response; never infer it from
  map zoom, a snapped road or coordinate precision.
- Survey answers remain accessible in a native keyboard/touch disclosure.
  View full record is the primary action; Review requires submission.update;
  editing and deletion retain their existing permissions and restrictions.
  Delete is under More and still invokes the existing confirmation flow.
- Mobile map selection uses a bottom sheet inside the map viewport with a
  bounded height, scrollable body, visible footer and explicit close/Escape.
- Detail pages stack cards at narrower widths. Instance ID, Device ID and
  User agent remain available under Technical details. Long values wrap.
- Provenance warnings remain visible. Evidence labels explicitly describe
  stored-byte integrity, preserve safe original-download gating and retain
  the warning that integrity does not verify the field claim. Full received
  timestamps and hashes are under Integrity details.

## Validation scope

Focused component and browser tests exercise the changed records and map
selection at desktop/mobile widths. Browser screenshots support visual
review. Broader shell checks cover dashboard, review, reports, forms and
collector workflows; shared styling does not imply that every specialized
page has received an individual redesign or live user acceptance.
