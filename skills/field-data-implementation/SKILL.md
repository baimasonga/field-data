---
name: field-data-implementation
description: Coordinate implementation of Field Data analysis, map layers, exports, public discovery, advanced form authoring, and operational support. Use when asked to implement the feature-gap roadmap or choose its next package.
---

# Field Data implementation

## Purpose

Implement the six feature packages identified after reviewing Field Data. The
comparison with Ona Data is provisional: current Ona documentation could not be
retrieved. These are independently defined product improvements, not verified
claims of Ona feature parity. Do not describe Ona as lacking or providing a
feature without checking a current source when that comparison is requested.

## Workflow

1. Read `references/engineering.md`, the repository status and relevant docs.
2. Inventory each requested feature as present, partial, absent, or unverified.
   Name the actual user-visible gap and preserve existing workflows.
3. If the user asks for all packages, maintain a task plan and implement them
   sequentially in reviewable slices. Prefer analysis, map layers, exports,
   browser authoring, public discovery, then operations; foundational operational
   fixes may precede this order. Do not assume permission to create agents.
4. Read the selected package's `SKILL.md` under the sibling directory listed
   below. Finish implementation and validation before moving to the next slice.
5. Record API/schema changes, dependencies, acceptance evidence and unfinished
   production checks in `docs/feature-delivery/`. Distinguish fixture tests,
   local service checks, deployment status, and real field validation.
6. Reconcile the entire roadmap after the last slice. A deployed screen is not
   sufficient evidence of collection, exports, sharing or disaster recovery.

## Packages

| Package | Skill directory | Outcome |
| --- | --- | --- |
| Analysis | `field-data-analysis-workspace` | Consistent data/table/chart/map exploration |
| Maps | `field-data-map-layers` | Configurable reference layers and thematic styling |
| Exports | `field-data-export-formats` | Documented, independently validated SAV/DTA/KML outputs |
| Public discovery | `field-data-public-catalog` | Explicitly published projects and safe datasets |
| Browser authoring | `field-data-advanced-form-builder` | Advanced XLSForm editing without a second publishing path |
| Operations | `field-data-managed-operations` | Monitoring, restore drills and service-support processes |

## Definition of done

All requested packages have a usable UI or operational deliverable, appropriate
server authorization, meaningful checks, documentation and an explicit remaining
production-acceptance list. Do not call a commercial service agreement or an
actual-device offline pilot implemented merely because code or a runbook exists.

