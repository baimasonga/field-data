# F5: groups of collectors whose submissions keep matching

Status: contract proposed and agreed with the project owner on 2026-10-10
("proceed"); details below decided under their delegated authority and open
to revision.

A single near-duplicate (F4), a shared identity key (F2) or an identical
location (G1) links two submissions. When the same collectors keep turning up
on both sides of such links, across many pairs and forms, that pattern is
worth a supervisor's attention in a way no single finding is: collectors
copying from each other, sharing a phone or a fabricated set of respondents.
F5 shows those patterns. It is the "collusion subgraphs" deliverable of the
fraud-intelligence row, first slice.

## What it does

- Reads the integrity findings already recorded for the project. Nothing new
  is collected, stored, or sent anywhere; the view is computed on request.
- **Links**: a finding of a pair rule (`near-duplicate`, `identity-reused:*`,
  `repeated-location`) whose two submissions were made by **two different
  collectors** links those collectors. Findings that were withdrawn, or
  resolved with the decision "explained", do not count. A pair by one
  collector is not a link between collectors (it stays the single finding it
  is).
- **Strength**: two collectors are connected when at least *N* findings link
  them (default 3; 2 to 20, chosen by the viewer).
- **Groups**: collectors connected directly or through each other. For each
  group: its members, each connection's count by rule, the forms involved,
  and the findings behind it (up to 50 per group), each linking to its form's
  Verification page.
- Groups are ordered by the number of linking findings. **No score, rank or
  label is given to any person.** The view states what a group is and is not,
  and the benign explanations: collectors working the same households or
  area, sharing a device by arrangement, or a form that leaves little room for
  answers to differ.

## Who sees what

Whoever can see the project's findings inbox (F3): a link counts only when
the caller may list and read submissions of the forms of **both** submissions
(an identity key may link to another form, F2b). App Users see nothing.
Collector names are display names, as elsewhere in review.

## API

`GET /v1/projects/:projectId/findings/collectors?minLinks=3`: `{ minLinks,
links, groups: [{ members: [{ actorId, displayName, links }], connections:
[{ a, b, links, byRule }], forms: [{ xmlFormId, formName }], findings: [{ id,
xmlFormId, rule, instanceId, relatedInstanceId, relatedXmlFormId }],
findingsShown, findingsTotal }] }`. Invalid `minLinks`: 400.8 (as other
filters).

## UI

On the Review page, after the findings inbox: "Collectors whose submissions
keep matching", with the minimum-links choice, the groups, and each group's
connections and findings collapsed.

## Not in this slice

Weights by rule or recency, communities inside large groups, links through
devices without a finding, alerts, a collector-level view over time.

## Acceptance

- Unit: links from pair findings across rules; same-collector pairs and
  unknown collectors left out; threshold; groups as connected components
  (including through a third member); ordering; caps on listed findings.
- Integration: groups from real near-duplicate and identity findings across
  two forms; withdrawn and explained findings left out; a form the caller may
  not read drops its links; viewer reads, App User refused; bad `minLinks`.
- Browser: groups, connections and links on the Review page; changing the
  minimum; an empty result says so.
