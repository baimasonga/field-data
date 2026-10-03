# Field Data implementation skills

This bundle defines six feature packages and a coordinating workflow. It builds
on the existing Field Data implementation; it does not implement the features
merely by creating skill files. The motivating Ona comparison is provisional,
not a verified parity checklist.

| Skill | Use it to |
| --- | --- |
| `field-data-implementation` | Coordinate the complete roadmap and track acceptance |
| `field-data-analysis-workspace` | Integrate tables, charts, maps and saved views |
| `field-data-map-layers` | Add reference layers and thematic styling |
| `field-data-export-formats` | Add native SAV, DTA and KML with independent validation |
| `field-data-public-catalog` | Add explicit, safe publication and public discovery |
| `field-data-advanced-form-builder` | Add advanced XLSForm authoring in the browser |
| `field-data-managed-operations` | Add monitoring, verified recovery and support runbooks |

## Use now

Ask Codex: **“Read `skills/field-data-implementation/SKILL.md` and implement the
next package.”** For one package, name its path instead. Files are usable by
explicit path without automatic skill discovery.

Suggested delivery order: analysis workspace, map layers, exports, advanced form
builder, public catalogue, operational support. Operational reliability fixes
can move earlier when they are prerequisites.

## Install for automatic discovery

From a writable local checkout:

```sh
python skills/install.py
```

This links every package into the repository's `.agents/skills/` directory,
Codex's standard repository skill-discovery location. Existing unrelated skills
are preserved; conflicting names are rejected. To use another discovery
location, pass `--destination /path/to/.agents/skills`. Keep the source checkout
available because installation uses links.

Start or refresh a Codex session after installation. Then invoke, for example,
**`$field-data-implementation`** or **`$field-data-map-layers`**. If a managed cloud
checkout mounts `.agents` read-only, use the explicit file-path instructions
above or install from a writable local checkout. The bundle has not been added
to a cloud plugin catalogue by creating these files.
