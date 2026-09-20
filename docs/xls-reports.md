# XLS Reports

XLS Reports turn a normal Excel workbook into a reusable report template.
They are available from a Project's **Reports** tab and can read a published
Form, a filtered dataset, or a merged dataset in that Project.

## Prepare a template

Create an `.xlsx` workbook no larger than 10 MB. Ordinary formatting, formulas,
merged cells, page setup, and additional worksheets remain part of the workbook.
Field Data only replaces placeholders.

Scalar placeholders may appear in any text cell:

| Placeholder | Value |
|---|---|
| `{{report_name}}` | Saved report-template name |
| `{{source_name}}` | Form or dataset name |
| `{{generated_at}}` | Generation date and time |
| `{{submission_count}}` | Number of included rows |

To create the detail table, add three consecutive rows:

1. A row containing `{{#submissions}}`.
2. One styled detail row containing field paths such as `{{/data/district}}`.
3. A row containing `{{/submissions}}`.

The middle row is repeated once for every included Submission. It may also use
`{{_instance_id}}`, `{{_submitted_at}}`, and `{{_source_form}}`. The latter is
especially useful for merged datasets.

Only one detail row is allowed in a block, and each worksheet may contain one
block. This restriction keeps row insertion, styles, and formula adjustment
predictable. Field paths are validated when the template is uploaded and again
when a report runs, so a republished Form cannot make a template expose a field
its source no longer permits.

## Generate and download

Select **Generate report** on a saved template. Generation runs in the
background and the page refreshes while a job is pending. A successful run
shows its row count and a download link. Pending or running jobs can be
cancelled.

Reports are limited to 10,000 rows. For a larger Form, create a filtered
dataset that describes the reporting period or district and use it as the
template's source. This bound protects the application container while ExcelJS
holds the workbook in memory.

Templates and generated workbooks use the configured Field Data storage
backend, including Supabase S3 storage when configured. Deleting a template
also deletes its generated reports.

## Permissions

Listing, generating, and downloading reports require Project access plus
`submission.list` and `submission.read`. Uploading or deleting a template also
requires `project.update`. A filtered dataset retains its own column and row
restrictions; a merged dataset is recalculated from the fields its Forms still
have in common.
