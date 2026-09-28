---
name: build-geospatial-field-intelligence
description: Design, implement, review, or test geospatial and Earth-observation capabilities for field-data systems. Use for satellite witness checks, survey-from-space task generation, landscape or infrastructure change detection, uncertainty maps, spatial sampling, field/satellite fusion, imagery provenance, map review workflows, and geographic validation of claims.
---

# Build Geospatial Field Intelligence

Fuse field observations with remote sensing without presenting uncertain imagery as ground truth. Read [references/features.md](references/features.md) and [references/geospatial-contract.md](references/geospatial-contract.md).

## Workflow

1. Define the claim and required spatial/temporal resolution before choosing imagery or a model.
2. Inspect coordinate systems, geometry validity, map stack, tile services, storage, spatial database, job queue, and field assignment workflow.
3. Select authoritative baselines and imagery sources. Record license, acquisition time, cloud cover, resolution, processing level, and geographic coverage.
4. Normalize geometry and imagery into an analysis-ready grid while preserving original references and transformations.
5. Create deterministic spatial checks before adding ML: containment, overlap, distance, area tolerance, temporal alignment, and coverage.
6. Run change or classification models asynchronously. Retain probability surfaces, quality masks, model version, and calibration metadata.
7. Convert uncertain findings into reviewable evidence or field-verification assignments.
8. Validate with geographically separated ground truth and monitor seasonal, atmospheric, sensor, and urban/rural performance shifts.

## Geospatial safeguards

- Never compare images without aligning coordinate reference, resolution, extent, and acquisition period.
- Distinguish “not visible,” “not covered,” “cloud-obscured,” and “model found no evidence.”
- Prevent exact sensitive household or respondent coordinates from appearing in broad-access maps.
- Generalize or aggregate maps according to role and use case.
- Keep human confirmation for changes with legal, enforcement, or payment consequences.
- Avoid claiming road, building, crop, or damage detection below the effective resolution of the source.

## Architecture pattern

Use `source catalog -> acquisition -> immutable raw asset -> analysis-ready derivative -> inference/check -> spatial finding -> review -> assignment/action`. Make jobs idempotent by source asset, area, algorithm version, and parameters. Store heavy raster data outside transactional tables; keep searchable metadata and vector footprints in the spatial database.

## Acceptance gate

Demonstrate provenance from map finding back to source imagery and transformation. Test CRS mismatch, invalid polygons, antimeridian if relevant, cloud/no-data masks, duplicate acquisitions, late imagery, low-resolution sources, overlapping jobs, and reviewer-to-field-assignment flow.
