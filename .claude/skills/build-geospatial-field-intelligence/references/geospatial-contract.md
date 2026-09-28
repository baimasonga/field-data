# Geospatial contract

## Source asset metadata

Record provider, collection ID, scene/tile ID, acquisition time, publication time, processing level, bands, ground sample distance, CRS, footprint, cloud/no-data percentage, license, checksum, and source URI reference.

## Spatial finding

Record finding ID/type, geometry, time interval, source asset IDs, algorithm/model and parameter version, confidence, quality-mask summary, reason codes, comparison baseline, review state, and linked claims/assignments.

## Precision policy

Store internal precision needed for analysis, but disclose only the precision appropriate to role and purpose. Use jitter, aggregation, grid cells, or masked centroids for sensitive subjects. Preserve exact coordinates only in restricted evidence stores.

## Validation

Use spatially and temporally held-out evaluation. Report class-specific precision/recall or intersection metrics, calibration, minimum detectable size, geographic coverage, seasonal robustness, and false-positive workload per area.
