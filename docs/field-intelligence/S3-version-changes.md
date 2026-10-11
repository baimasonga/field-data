# S3: changes between form versions

Status: next slice chosen under the project owner's delegated authority
("continue implementing", 2026-10-11), following S1 and S2; details open to
revision.

A form is changed while data is being collected: a question is reworded, a
choice is added, a question is moved into a roster. Some changes leave the
data comparable across versions; others mean that one column holds answers to
different questions, or that a series stops. Today nothing says which. S3
compares two versions of a form definition and lists every change to what is
collected, each with its effect on the data in words. It is the "schema and
version preservation" item of the adaptive-surveys row; it never blocks
publishing and changes nothing.

## What is compared

Every question, calculation and repeat of the two versions, matched by its
path; a question whose path changed but whose name is unique in both versions
is matched by name and reported as moved. The form's `meta` block is left
out. For each matched pair the comparison looks at:

- data type (`int`, `decimal`, `select1`, …) and control (single or multiple
  choice);
- whether it sits in a repeat, and which one;
- label, in every language the two versions share;
- choices: values added, values removed, and values whose label changed;
- whether its choices come from a file, a filter or a search (not compared
  item by item);
- `relevant`, `constraint`, `required`, `calculate` and `readonly`
  expressions, compared after removing whitespace differences.
  Relevance and read-only also apply to everything inside a group: a group
  whose condition changed is reported on the group, and a question that
  moved is compared with every condition above it as well as its own
  (`inherited: true` in the detail).

## Effects

Each change has one effect, the strongest that applies:

| Effect | Meaning | Changes |
| --- | --- | --- |
| **Meaning** | Answers in one column may not mean the same thing across versions; analyses joining the versions need a recode or a note. | Data type changed; single ↔ multiple choice; moved into, out of or between repeats; a choice value kept but given a different label; a calculation's formula changed. |
| **Continuity** | A column starts, ends or is renamed in exports. | Added; removed; moved (path changed, same name). |
| **Who or what** | The same question, but asked of different people or accepting different answers. | `relevant`, `constraint`, `required` or `readonly` changed; choices added or removed; a choice list now from a file, filter or search, or no longer. |
| **Wording** | The question reads differently; usually comparable, but worth a note. | Label changed in a language. |

A change to a choice's label counts as **Meaning** because the stored value
stays the same while the respondent saw something else.

Central refuses a new version that changes a field's data type at the same
path (400.17), so between published versions a type change appears only for
a question that also moved.

## Baseline

- The **Draft** is compared with the published version.
- A **published version** is compared with the version published just before
  it.
- `?from=<version>` compares with any published version of the same form
  instead. A version with no version string is named `___`, as elsewhere in
  the API.

If there is no baseline (a first version, or a draft of an unpublished form)
the answer says so and lists nothing.

## API

`GET /v1/projects/:projectId/forms/:xmlFormId/changes`,
`…/draft/changes` and `…/versions/:version/changes`, for anyone who may read
the form. Response:

```
{ from: { version, hash } | null, to: { version, hash, draft },
  summary: { meaning, continuity, population, wording, unchanged },
  changes: [{ effect, code, path, fromPath, detail }], truncated }
```

`code` is one of `added`, `removed`, `moved`, `type-changed`,
`choice-kind-changed`, `repeat-changed`, `calculation-changed`,
`choice-relabelled`, `relevant-changed`, `constraint-changed`,
`required-changed`, `readonly-changed`, `choices-added`, `choices-removed`,
`choice-source-changed`, `label-changed`. `detail` gives the old and new
value in words or as expressions. Changes are listed in the new version's
order, removed questions last; at most 1000 are returned (`truncated` says
when there were more). Computed on request; nothing is stored. Forms too
large for the survey doctor are refused the same way (400.57); a `from` that is not a single version string is 400.63.

## UI

Draft page, after the form check: **Changes from the published version**,
grouped by effect with Meaning first, each change with its path and old and
new value. The publish dialog states how many changes affect meaning, if any,
and still lets the person publish.

## Not in this slice

Compatibility mappings or recodes applied to exports, approval of changes,
comparisons across different forms, attachments (CSV choice files), entity
properties, and hints or media in labels.

## Acceptance

- Unit: every code; matching by path and by unique name; no match for a name
  used twice; whitespace-only expression changes ignored; meta ignored;
  effect order; truncation.
- Integration: draft against published, a version against the previous one,
  `?from`, an unknown `from` (404), a first version (no baseline), read
  permission, a form too large.
- Browser: the Draft panel grouped by effect; the publish dialog's count.
