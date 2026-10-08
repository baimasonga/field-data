---
name: field-data-map-layers
description: Implement configurable Field Data map reference layers, GeoJSON uploads, thematic styles and layer visibility. Use when implementing custom map layers or map configuration.
---

# Field Data map layers

## Inspect first

- `central/client/apps/central/src/components/geojson-map.vue` uses OpenLayers.
- `central/client/apps/central/src/components/field-data/explore.vue` uses Leaflet.
- `central/client/apps/central/src/components/map/` and `submission/map-view.vue`.
- `central/server/lib/resources/geo-extracts.js`, storage adapters and migrations.

Submission maps, GeoJSON and clustering already exist. Decide which map surface
owns configuration; share definitions without replacing both rendering engines.

## Implementation

1. Introduce a versioned project-level layer definition with owner, title,
   visibility, source type, coordinate reference, extent and style settings.
   Read and editing permissions must follow the project's existing access model.
2. Start with uploaded GeoJSON FeatureCollections in WGS84 (longitude, latitude).
   Validate geometry, finite coordinates, properties, file size and feature count.
   Preserve a useful error for unsupported CRS or invalid geometry. Store files
   with the existing storage adapter; do not rely on container-local persistence.
3. Add upload/replace/remove, reorder, toggle, legend and fit-to-layer controls.
   Support categorical styling and numeric choropleths with declared bins,
   units and missing-data styles. Do not silently recompute incomparable bins
   when applying filters.
4. Render labels/popups as escaped text. Strip or reject unsupported active
   content. A layer must not expose submission fields its viewer cannot read.
5. If adding remote tile/WMS sources, reuse outbound URL protections and bound
   timeouts. Protect credentials, preserve attribution, handle browser CORS and
   define which hostnames/network requirements actually need configuration.
6. Bound rendering cost, avoid redundant file downloads, and expose a table or
   text alternative to color-only map information.

## Acceptance

Authorized editors save layers and styles; authorized readers see the same
configuration after reload. Revocation removes access to definitions and files.
Tests cover coordinates, malformed/oversized files, layer order, missing values,
restricted properties, popup injection and failed downloads. Compare rendered
locations with known geographic fixtures. Verify storage cleanup on deletion.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
