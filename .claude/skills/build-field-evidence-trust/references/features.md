# Feature specifications

## Proof-of-Presence Engine

Fuse independent signals into a signed presence assertion. Return a classification, component results, evidence coverage, and limitations. Improve trust without pretending spoofing is impossible.

## Field Evidence Graph

Model `entity -> claim -> evidence -> verification -> confidence -> review -> action`. Make links queryable and temporal. Support evidence that confirms, contradicts, or is neutral.

## Reality Score

Aggregate calibrated components for triage. Preserve component values, reasons, missing-data markers, policy version, and threshold. Never use the total alone for discipline.

## GPS Spoofing Radar

Compare GNSS with inertial motion, network-derived coarse position, speed, route continuity, satellite quality, device integrity, and impossible transitions. Produce reason codes such as `LOCATION_JUMP` or `MOTION_GNSS_MISMATCH`.

## Environmental Fingerprint

Create a privacy-preserving representation of radio and sensor context. Salt and rotate features, avoid storing raw MAC addresses, and compare probabilistically because environments change.

## Human Motion Proof

Classify coarse activity phases—travel, walk, stop, interact, interview—rather than identifying an individual. Run on device where practical and retain summaries instead of raw streams.

## Random Reality Challenge

Issue unpredictable, nonce-bound capture instructions after arrival. Keep accessible alternatives and a supervisor override for disability, safety, cultural, or environmental constraints.

## Proof-of-Life Media

Validate short capture sequences using continuity, motion, capture provenance, and replay checks. Do not claim synthetic-media detection is infallible.

## Cross-Collector Witnessing

Exchange signed, minimal proximity tokens over short-range radio. Prevent either collector from learning the other’s submissions and mitigate collusion with rotating challenges and server correlation.

## Community Witness Network

Deploy managed beacons or NFC points with rotating signed tokens. Include provisioning, revocation, battery health, clock tolerance, replacement, tamper reporting, and offline verification.

## Field Black Box

Maintain a compressed encrypted event log of capture state and selected integrity signals. Minimize content and set strict access, retention, and export controls.

## Survey Replay

Render a human-readable timeline from audit events. Show clock uncertainty, offline intervals, location quality, edits, challenges, media, and sync attempts without implying missing events never occurred.
