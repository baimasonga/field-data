# Source inventory index

Audited source: `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02`. Generated from tracked repository files; pending audit-package files are not part of this baseline.

This is a declaration inventory, not an acceptance certificate. Runtime prefixes and conditional branches must be considered. The 303 server resource declarations include 41 dynamic expressions. The full exact module, migration, test-tree, configuration-name and registration lists are in [SOURCE_INVENTORY.json](SOURCE_INVENTORY.json). Test-tree files include fixtures and helpers; their count is not the number of tests executed.

## Backend route declarations

API version rewriting is in `central/server/lib/http/middleware.js`; routes below are shown before that rewriting. Dynamic expressions are retained rather than guessed.

| Method | Route or expression | Source |
| --- | --- | --- |
| POST | `/projects/:projectId/actor-properties` | `central/server/lib/resources/actor-properties.js:9` |
| GET | `/projects/:projectId/actor-properties` | `central/server/lib/resources/actor-properties.js:22` |
| GET | `/analytics/preview` | `central/server/lib/resources/analytics.js:17` |
| GET | `/projects/:projectId/app-users` | `central/server/lib/resources/app-users.js:18` |
| POST | `/projects/:projectId/app-users` | `central/server/lib/resources/app-users.js:24` |
| GET | `/projects/:projectId/app-users/:id` | `central/server/lib/resources/app-users.js:40` |
| DELETE | `/projects/:projectId/app-users/:id` | `central/server/lib/resources/app-users.js:47` |
| PATCH | `/projects/:projectId/app-users/:id` | `central/server/lib/resources/app-users.js:58` |
| GET | `/projects/:id/assignments/forms` | `central/server/lib/resources/assignments.js:27` |
| GET | `/projects/:id/assignments/forms/:roleId` | `central/server/lib/resources/assignments.js:33` |
| GET | ``${base}/assignments`` | `central/server/lib/resources/assignments.js:49` |
| GET | ``${base}/assignments/:roleId`` | `central/server/lib/resources/assignments.js:54` |
| POST | ``${base}/assignments/:roleId/:actorId`` | `central/server/lib/resources/assignments.js:63` |
| DELETE | ``${base}/assignments/:roleId/:actorId`` | `central/server/lib/resources/assignments.js:77` |
| GET | `/audits` | `central/server/lib/resources/audits.js:14` |
| POST | `/backup` | `central/server/lib/resources/backup.js:22` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions/:id/comments` | `central/server/lib/resources/comments.js:15` |
| POST | `/projects/:projectId/forms/:xmlFormId/submissions/:id/comments` | `central/server/lib/resources/comments.js:28` |
| POST | `/config/:key` | `central/server/lib/resources/config.js:33` |
| GET | `/config/public` | `central/server/lib/resources/config.js:50` |
| GET | `/config/public/:key` | `central/server/lib/resources/config.js:70` |
| GET | `/config/:key` | `central/server/lib/resources/config.js:86` |
| DELETE | `/config/:key` | `central/server/lib/resources/config.js:93` |
| GET | `/projects/:id/datasets` | `central/server/lib/resources/datasets.js:21` |
| GET | `/projects/:projectId/datasets/:name` | `central/server/lib/resources/datasets.js:27` |
| PATCH | `/projects/:projectId/datasets/:name` | `central/server/lib/resources/datasets.js:33` |
| DELETE | `/projects/:projectId/datasets/:name` | `central/server/lib/resources/datasets.js:108` |
| POST | `/projects/:id/datasets` | `central/server/lib/resources/datasets.js:119` |
| POST | `/projects/:projectId/datasets/:name/properties` | `central/server/lib/resources/datasets.js:132` |
| DELETE | `/projects/:projectId/datasets/:name/properties/:propertyName` | `central/server/lib/resources/datasets.js:144` |
| GET | `/projects/:projectId/datasets/:name/entities.csv` | `central/server/lib/resources/datasets.js:184` |
| GET | `/projects/:projectId/trash/datasets/:datasetId/entities.csv` | `central/server/lib/resources/datasets.js:213` |
| GET | `/projects/:projectId/datasets/:name/integrity` | `central/server/lib/resources/datasets.js:227` |
| GET | `/projects/:projectId/datasets/:name/entities` | `central/server/lib/resources/entities.js:21` |
| GET | `/projects/:projectId/datasets/:name/entities/creators` | `central/server/lib/resources/entities.js:30` |
| GET | `/projects/:projectId/datasets/:name/entities/:uuid` | `central/server/lib/resources/entities.js:39` |
| GET | `/projects/:projectId/datasets/:name/entities/:uuid/versions` | `central/server/lib/resources/entities.js:52` |
| GET | `/projects/:projectId/datasets/:name/entities/:uuid/diffs` | `central/server/lib/resources/entities.js:73` |
| GET | `/projects/:projectId/datasets/:name/entities/:uuid/audits` | `central/server/lib/resources/entities.js:88` |
| GET | `/projects/:projectId/datasets/:name/entities/:uuid/geojson` | `central/server/lib/resources/entities.js:101` |
| POST | `/projects/:id/datasets/:name/entities` | `central/server/lib/resources/entities.js:119` |
| PATCH | `/projects/:id/datasets/:name/entities/:uuid` | `central/server/lib/resources/entities.js:154` |
| DELETE | `/projects/:projectId/datasets/:name/entities/:uuid` | `central/server/lib/resources/entities.js:195` |
| POST | `/projects/:projectId/datasets/:name/entities/:uuid/restore` | `central/server/lib/resources/entities.js:209` |
| POST | `/projects/:projectId/datasets/:name/entities/bulk-delete` | `central/server/lib/resources/entities.js:222` |
| POST | `/projects/:projectId/datasets/:name/entities/bulk-restore` | `central/server/lib/resources/entities.js:234` |
| POST | `/projects/:projectId/analysis/export/:format` | `central/server/lib/resources/field-data-analysis.js:13` |
| GET | `/projects/:projectId/analysis/sources` | `central/server/lib/resources/field-data-analysis.js:24` |
| POST | `/projects/:projectId/analysis/query` | `central/server/lib/resources/field-data-analysis.js:34` |
| GET | `/projects/:projectId/analysis/views` | `central/server/lib/resources/field-data-analysis.js:54` |
| POST | `/projects/:projectId/analysis/views` | `central/server/lib/resources/field-data-analysis.js:66` |
| PUT | `/projects/:projectId/analysis/views/:id` | `central/server/lib/resources/field-data-analysis.js:89` |
| DELETE | `/projects/:projectId/analysis/views/:id` | `central/server/lib/resources/field-data-analysis.js:104` |
| GET | `/field-data/review-queue/:caseId/backcheck-assignees` | `central/server/lib/resources/field-data-backchecks.js:39` |
| GET | `/field-data/review-queue/:caseId/backchecks` | `central/server/lib/resources/field-data-backchecks.js:52` |
| POST | `/field-data/review-queue/:caseId/backchecks` | `central/server/lib/resources/field-data-backchecks.js:70` |
| POST | `/field-data/review-queue/:caseId/backchecks/:backcheckId/cancel` | `central/server/lib/resources/field-data-backchecks.js:141` |
| POST | `/field-data/review-queue/:caseId/backchecks/:backcheckId/link` | `central/server/lib/resources/field-data-backchecks.js:190` |
| POST | `/projects/:projectId/catalog/fields` | `central/server/lib/resources/field-data-catalog.js:39` |
| POST | `/projects/:projectId/catalog/preview` | `central/server/lib/resources/field-data-catalog.js:46` |
| POST | `/projects/:projectId/catalog/publish` | `central/server/lib/resources/field-data-catalog.js:50` |
| GET | `/projects/:projectId/catalog` | `central/server/lib/resources/field-data-catalog.js:63` |
| DELETE | `/projects/:projectId/catalog/:id` | `central/server/lib/resources/field-data-catalog.js:67` |
| GET | `/field-data/catalog/projects/:id` | `central/server/lib/resources/field-data-catalog.js:76` |
| GET | `/field-data/catalog` | `central/server/lib/resources/field-data-catalog.js:83` |
| GET | `/field-data/catalog/:id` | `central/server/lib/resources/field-data-catalog.js:88` |
| GET | `/field-data/claim-health` | `central/server/lib/resources/field-data-claims.js:31` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/claim` | `central/server/lib/resources/field-data-claims.js:37` |
| GET | `/field-data/claim-versions/:claimVersionId` | `central/server/lib/resources/field-data-claims.js:56` |
| POST | `/field-data/claim-versions/:claimVersionId/evidence-links` | `central/server/lib/resources/field-data-evidence.js:46` |
| GET | `/field-data/claim-versions/:claimVersionId/evidence` | `central/server/lib/resources/field-data-evidence.js:86` |
| GET | `/field-data/evidence/:evidenceId` | `central/server/lib/resources/field-data-evidence.js:117` |
| GET | `/field-data/evidence/:evidenceId/derivations/:derivationId/content` | `central/server/lib/resources/field-data-evidence.js:120` |
| GET | `/field-data/evidence/:evidenceId/content` | `central/server/lib/resources/field-data-evidence.js:135` |
| POST | `/projects/:projectId/analysis/jobs` | `central/server/lib/resources/field-data-export-jobs.js:29` |
| GET | `/projects/:projectId/analysis/jobs` | `central/server/lib/resources/field-data-export-jobs.js:50` |
| GET | `/projects/:projectId/analysis/jobs/:id/download` | `central/server/lib/resources/field-data-export-jobs.js:56` |
| DELETE | `/projects/:projectId/analysis/jobs/:id` | `central/server/lib/resources/field-data-export-jobs.js:61` |
| POST | `/projects/:projectId/map-layers/remote` | `central/server/lib/resources/field-data-map-layers.js:22` |
| GET | `/projects/:projectId/map-layers/:id/tile` | `central/server/lib/resources/field-data-map-layers.js:31` |
| GET | `/projects/:projectId/map-layers` | `central/server/lib/resources/field-data-map-layers.js:39` |
| POST | `/projects/:projectId/map-layers` | `central/server/lib/resources/field-data-map-layers.js:44` |
| PUT | `/projects/:projectId/map-layers/:id` | `central/server/lib/resources/field-data-map-layers.js:55` |
| DELETE | `/projects/:projectId/map-layers/:id` | `central/server/lib/resources/field-data-map-layers.js:100` |
| GET | `/field-data/operations` | `central/server/lib/resources/field-data-operations.js:6` |
| PUT | `/field-data/operations/policy` | `central/server/lib/resources/field-data-operations.js:11` |
| POST | `/field-data/review-queue/:caseId/decisions` | `central/server/lib/resources/field-data-reviews.js:21` |
| PATCH | `/field-data/review-queue/:caseId/assignment` | `central/server/lib/resources/field-data-reviews.js:79` |
| GET | `/field-data/review-queue` | `central/server/lib/resources/field-data-reviews.js:129` |
| GET | `/field-data/review-queue/:caseId` | `central/server/lib/resources/field-data-reviews.js:169` |
| GET | `/field-data/explore` | `central/server/lib/resources/field-data-workspaces.js:88` |
| GET | `/field-data/explore.csv` | `central/server/lib/resources/field-data-workspaces.js:191` |
| GET | `/field-data/team` | `central/server/lib/resources/field-data-workspaces.js:260` |
| GET | `/field-data/review` | `central/server/lib/resources/field-data-workspaces.js:291` |
| POST | `/field-data/review` | `central/server/lib/resources/field-data-workspaces.js:414` |
| GET | `/field-data/cleaning` | `central/server/lib/resources/field-data-workspaces.js:441` |
| GET | `/field-data/quality-rules` | `central/server/lib/resources/field-data-workspaces.js:494` |
| PATCH | `/field-data/quality-rules/:key` | `central/server/lib/resources/field-data-workspaces.js:499` |
| GET | `/field-data/templates` | `central/server/lib/resources/field-data-workspaces.js:519` |
| POST | `/field-data/templates` | `central/server/lib/resources/field-data-workspaces.js:530` |
| DELETE | `/field-data/templates/:id` | `central/server/lib/resources/field-data-workspaces.js:568` |
| GET | `/field-data/cases` | `central/server/lib/resources/field-data-workspaces.js:584` |
| POST | `/field-data/cases` | `central/server/lib/resources/field-data-workspaces.js:608` |
| GET | `/field-data/cases/:id` | `central/server/lib/resources/field-data-workspaces.js:619` |
| PATCH | `/field-data/cases/:id` | `central/server/lib/resources/field-data-workspaces.js:645` |
| POST | `/field-data/cases/:id/link` | `central/server/lib/resources/field-data-workspaces.js:666` |
| GET | `/field-data/assignments` | `central/server/lib/resources/field-data-workspaces.js:678` |
| POST | `/field-data/assignments` | `central/server/lib/resources/field-data-workspaces.js:699` |
| PATCH | `/field-data/assignments/:id` | `central/server/lib/resources/field-data-workspaces.js:710` |
| GET | `/field-data/report` | `central/server/lib/resources/field-data-workspaces.js:793` |
| GET | `/field-data/dhis2-settings` | `central/server/lib/resources/field-data-workspaces.js:799` |
| PATCH | `/field-data/dhis2-settings` | `central/server/lib/resources/field-data-workspaces.js:804` |
| GET | `/field-data/dhis2` | `central/server/lib/resources/field-data-workspaces.js:827` |
| GET | `/field-data/shares` | `central/server/lib/resources/field-data-workspaces.js:862` |
| POST | `/field-data/shares` | `central/server/lib/resources/field-data-workspaces.js:870` |
| DELETE | `/field-data/shares/:id` | `central/server/lib/resources/field-data-workspaces.js:881` |
| GET | `/field-data/public/report/:token` | `central/server/lib/resources/field-data-workspaces.js:892` |
| GET | `/field-data/form-builder/question-types` | `central/server/lib/resources/field-data.js:648` |
| POST | `/projects/:projectId/form-builder/import` | `central/server/lib/resources/field-data.js:655` |
| POST | `/projects/:projectId/form-builder/validate` | `central/server/lib/resources/field-data.js:662` |
| POST | `/projects/:projectId/form-builder/xlsform` | `central/server/lib/resources/field-data.js:676` |
| GET | `/projects/:projectId/forms/:xmlFormId/builder-definition` | `central/server/lib/resources/field-data.js:698` |
| PUT | `/projects/:projectId/forms/:xmlFormId/builder-definition` | `central/server/lib/resources/field-data.js:708` |
| GET | `/projects/:projectId/forms/:xmlFormId/summary` | `central/server/lib/resources/field-data.js:730` |
| GET | `/projects/:projectId/forms/:xmlFormId/submission-import/template.csv` | `central/server/lib/resources/field-data.js:777` |
| POST | `/projects/:projectId/forms/:xmlFormId/submission-import/dry-run` | `central/server/lib/resources/field-data.js:787` |
| POST | `/projects/:projectId/forms/:xmlFormId/submission-import/commit` | `central/server/lib/resources/field-data.js:798` |
| GET | `/projects/:projectId/forms/:xmlFormId/filtered-datasets` | `central/server/lib/resources/field-data.js:909` |
| GET | `/projects/:projectId/forms/:xmlFormId/filter-fields` | `central/server/lib/resources/field-data.js:933` |
| POST | `/projects/:projectId/forms/:xmlFormId/filtered-datasets/preview` | `central/server/lib/resources/field-data.js:942` |
| POST | `/projects/:projectId/filtered-datasets` | `central/server/lib/resources/field-data.js:953` |
| GET | `/projects/:projectId/filtered-datasets` | `central/server/lib/resources/field-data.js:974` |
| GET | `/projects/:projectId/filtered-datasets/:id` | `central/server/lib/resources/field-data.js:994` |
| GET | `/projects/:projectId/filtered-datasets/:id/definition` | `central/server/lib/resources/field-data.js:1005` |
| PATCH | `/projects/:projectId/filtered-datasets/:id` | `central/server/lib/resources/field-data.js:1018` |
| DELETE | `/projects/:projectId/filtered-datasets/:id` | `central/server/lib/resources/field-data.js:1044` |
| GET | `/projects/:projectId/filtered-datasets/:id/data` | `central/server/lib/resources/field-data.js:1060` |
| GET | `/projects/:projectId/filtered-datasets/:id/export.csv` | `central/server/lib/resources/field-data.js:1137` |
| GET | `/projects/:projectId/filtered-datasets/:id/export.xlsx` | `central/server/lib/resources/field-data.js:1141` |
| POST | `/projects/:projectId/widgets` | `central/server/lib/resources/field-data.js:1223` |
| GET | `/projects/:projectId/widgets` | `central/server/lib/resources/field-data.js:1241` |
| PATCH | `/projects/:projectId/widgets/order` | `central/server/lib/resources/field-data.js:1282` |
| PATCH | `/projects/:projectId/widgets/:id` | `central/server/lib/resources/field-data.js:1311` |
| DELETE | `/projects/:projectId/widgets/:id` | `central/server/lib/resources/field-data.js:1336` |
| GET | `/field-data/organization-roles` | `central/server/lib/resources/field-data.js:1403` |
| GET | `/field-data/organizations` | `central/server/lib/resources/field-data.js:1411` |
| POST | `/field-data/organizations` | `central/server/lib/resources/field-data.js:1430` |
| GET | `/field-data/organizations/:slug` | `central/server/lib/resources/field-data.js:1455` |
| PATCH | `/field-data/organizations/:slug` | `central/server/lib/resources/field-data.js:1465` |
| POST | `/field-data/organizations/:slug/projects` | `central/server/lib/resources/field-data.js:1486` |
| DELETE | `/field-data/organizations/:slug/projects/:projectId` | `central/server/lib/resources/field-data.js:1507` |
| GET | `/field-data/organizations/:slug/members` | `central/server/lib/resources/field-data.js:1524` |
| POST | `/field-data/organizations/:slug/members` | `central/server/lib/resources/field-data.js:1538` |
| DELETE | `/field-data/organizations/:slug/members/:actorId` | `central/server/lib/resources/field-data.js:1580` |
| POST | `/projects/:projectId/merged-datasets` | `central/server/lib/resources/field-data.js:1662` |
| GET | `/projects/:projectId/merged-datasets` | `central/server/lib/resources/field-data.js:1690` |
| GET | `/projects/:projectId/merged-datasets/:id` | `central/server/lib/resources/field-data.js:1704` |
| DELETE | `/projects/:projectId/merged-datasets/:id` | `central/server/lib/resources/field-data.js:1721` |
| GET | `/projects/:projectId/merged-datasets/:id/data` | `central/server/lib/resources/field-data.js:1732` |
| GET | `/projects/:projectId/xls-report-sources` | `central/server/lib/resources/field-data.js:1821` |
| GET | `/projects/:projectId/xls-report-templates` | `central/server/lib/resources/field-data.js:1839` |
| POST | `/projects/:projectId/xls-report-templates` | `central/server/lib/resources/field-data.js:1844` |
| GET | `/projects/:projectId/xls-report-templates/:id/download` | `central/server/lib/resources/field-data.js:1885` |
| DELETE | `/projects/:projectId/xls-report-templates/:id` | `central/server/lib/resources/field-data.js:1893` |
| POST | `/projects/:projectId/xls-report-templates/:id/runs` | `central/server/lib/resources/field-data.js:1909` |
| POST | `/projects/:projectId/xls-report-templates/:id/runs/:runId/cancel` | `central/server/lib/resources/field-data.js:1924` |
| GET | `/projects/:projectId/xls-report-templates/:id/runs/:runId/download` | `central/server/lib/resources/field-data.js:1933` |
| GET | `/projects/:projectId/forms/:xmlFormId/evidence` | `central/server/lib/resources/field-data.js:2048` |
| POST | `/projects/:projectId/forms/:xmlFormId/integrity/run` | `central/server/lib/resources/field-data.js:2077` |
| GET | `/projects/:projectId/forms/:xmlFormId/integrity` | `central/server/lib/resources/field-data.js:2137` |
| PATCH | `/projects/:projectId/forms/:xmlFormId/integrity/:id` | `central/server/lib/resources/field-data.js:2164` |
| GET | `/projects/:projectId/summary` | `central/server/lib/resources/field-data.js:2215` |
| GET | `/projects/:projectId/forms/:xmlFormId/dashboards` | `central/server/lib/resources/field-data.js:2299` |
| POST | `/projects/:projectId/forms/:xmlFormId/dashboards` | `central/server/lib/resources/field-data.js:2311` |
| DELETE | `/projects/:projectId/forms/:xmlFormId/dashboards/:id` | `central/server/lib/resources/field-data.js:2349` |
| GET | `/field-data/shared/:token` | `central/server/lib/resources/field-data.js:2364` |
| GET | `/projects/:projectId/forms/:xmlFormId/photos` | `central/server/lib/resources/field-data.js:2414` |
| GET | `/field-data/forms` | `central/server/lib/resources/field-data.js:2463` |
| GET | `/field-data/submissions` | `central/server/lib/resources/field-data.js:2493` |
| GET | `/field-data/map` | `central/server/lib/resources/field-data.js:2547` |
| GET | `/field-data/stats` | `central/server/lib/resources/field-data.js:2620` |
| GET | `/field-data/media` | `central/server/lib/resources/field-data.js:2732` |
| POST | `/field-data/media` | `central/server/lib/resources/field-data.js:2737` |
| DELETE | `/field-data/media/:id` | `central/server/lib/resources/field-data.js:2767` |
| GET | `/field-data/media/download/:id` | `central/server/lib/resources/field-data.js:2779` |
| GET | `/field-data/webhooks` | `central/server/lib/resources/field-data.js:2793` |
| GET | `/field-data/integration-forms` | `central/server/lib/resources/field-data.js:2811` |
| POST | `/field-data/webhooks` | `central/server/lib/resources/field-data.js:2823` |
| GET | `/field-data/webhook-targets` | `central/server/lib/resources/field-data.js:2889` |
| GET | `/field-data/webhooks/:id/deliveries` | `central/server/lib/resources/field-data.js:2894` |
| GET | `/field-data/webhooks/:id/syncs` | `central/server/lib/resources/field-data.js:2904` |
| POST | `/field-data/webhooks/:id/syncs` | `central/server/lib/resources/field-data.js:2915` |
| POST | `/field-data/webhooks/:id/syncs/:syncId/retry` | `central/server/lib/resources/field-data.js:2926` |
| POST | `/field-data/webhooks/:id/syncs/:syncId/cancel` | `central/server/lib/resources/field-data.js:2944` |
| PATCH | `/field-data/webhooks/:id` | `central/server/lib/resources/field-data.js:2954` |
| POST | `/field-data/webhooks/:id/rotate-secret` | `central/server/lib/resources/field-data.js:3021` |
| DELETE | `/field-data/webhooks/:id` | `central/server/lib/resources/field-data.js:3031` |
| GET | `/field-data/backups` | `central/server/lib/resources/field-data.js:3039` |
| POST | `/field-data/backups` | `central/server/lib/resources/field-data.js:3047` |
| GET | `/field-data/backups/:id/download` | `central/server/lib/resources/field-data.js:3067` |
| GET | `/projects/:projectId/forms` | `central/server/lib/resources/forms.js:81` |
| GET | `/projects/:projectId/formList` | `central/server/lib/resources/forms.js:88` |
| POST | `/projects/:projectId/forms` | `central/server/lib/resources/forms.js:128` |
| POST | `/projects/:projectId/forms/:xmlFormId/draft` | `central/server/lib/resources/forms.js:139` |
| POST | `/projects/:projectId/forms/:xmlFormId/draft/publish` | `central/server/lib/resources/forms.js:161` |
| GET | `/projects/:projectId/forms/:xmlFormId/draft/dataset-diff` | `central/server/lib/resources/forms.js:190` |
| GET | `/projects/:projectId/forms/:xmlFormId/dataset-diff` | `central/server/lib/resources/forms.js:210` |
| PATCH | `/projects/:projectId/forms/:xmlFormId/draft/attachments/:name` | `central/server/lib/resources/forms.js:230` |
| DELETE | `/projects/:projectId/forms/:xmlFormId/draft` | `central/server/lib/resources/forms.js:251` |
| GET | ``${base}.xml`` | `central/server/lib/resources/forms.js:272` |
| GET | ``${base}.xls`` | `central/server/lib/resources/forms.js:288` |
| GET | ``${base}.xlsx`` | `central/server/lib/resources/forms.js:289` |
| GET | ``${base}`` | `central/server/lib/resources/forms.js:291` |
| GET | ``${base}/fields`` | `central/server/lib/resources/forms.js:306` |
| GET | ``${base}/manifest`` | `central/server/lib/resources/forms.js:313` |
| GET | ``${base}/attachments`` | `central/server/lib/resources/forms.js:332` |
| GET | ``${base}/attachments/:name`` | `central/server/lib/resources/forms.js:337` |
| GET | `/form-links/:enketoId/form` | `central/server/lib/resources/forms.js:362` |
| PATCH | `/projects/:projectId/forms/:xmlFormId` | `central/server/lib/resources/forms.js:370` |
| DELETE | `/projects/:projectId/forms/:xmlFormId` | `central/server/lib/resources/forms.js:379` |
| GET | `/projects/:projectId/forms/:xmlFormId/versions` | `central/server/lib/resources/forms.js:390` |
| POST | `/projects/:projectId/forms/:numericFormId/restore` | `central/server/lib/resources/forms.js:410` |
| POST | `/projects/:projectId/forms/:xmlFormId/draft/attachments/:name` | `central/server/lib/resources/forms.js:449` |
| DELETE | `/projects/:projectId/forms/:xmlFormId/draft/attachments/:name` | `central/server/lib/resources/forms.js:463` |
| GET | `/test/:key/projects/:projectId/forms/:xmlFormId/draft/formList` | `central/server/lib/resources/forms.js:488` |
| GET | `/test/:key/projects/:projectId/forms/:xmlFormId/draft/manifest` | `central/server/lib/resources/forms.js:503` |
| GET | `/test/:key/projects/:projectId/forms/:xmlFormId/draft.xml` | `central/server/lib/resources/forms.js:512` |
| GET | `/test/:key/projects/:projectId/forms/:xmlFormId/draft/attachments/:name` | `central/server/lib/resources/forms.js:519` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId.geojson` | `central/server/lib/resources/geo-extracts.js:39` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions/:rootId/versions/:instanceId.geojson` | `central/server/lib/resources/geo-extracts.js:43` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions.geojson` | `central/server/lib/resources/geo-extracts.js:49` |
| GET | `/projects/:projectId/datasets/:datasetName/entities.geojson` | `central/server/lib/resources/geo-extracts.js:73` |
| GET | `/projects/:projectId/datasets/:name.svc` | `central/server/lib/resources/odata-entities.js:26` |
| GET | `/projects/:projectId/datasets/:name.svc/([$])metadata` | `central/server/lib/resources/odata-entities.js:34` |
| GET | `/projects/:projectId/datasets/:name.svc/Entities` | `central/server/lib/resources/odata-entities.js:43` |
| GET | `base` | `central/server/lib/resources/odata.js:26` |
| GET | ``${base}/([$])metadata`` | `central/server/lib/resources/odata.js:35` |
| GET | ``${base}/Submissions\\(:uuid\\)`` | `central/server/lib/resources/odata.js:57` |
| GET | ``${base}/Submissions\\(:uuid\\)/*`` | `central/server/lib/resources/odata.js:58` |
| GET | ``${base}/:table`` | `central/server/lib/resources/odata.js:61` |
| GET | `/oidc/login` | `central/server/lib/resources/oidc.js:111` |
| GET | `/oidc/callback` | `central/server/lib/resources/oidc.js:143` |
| GET | `/projects` | `central/server/lib/resources/projects.js:19` |
| POST | `/projects` | `central/server/lib/resources/projects.js:35` |
| GET | `/projects/:id` | `central/server/lib/resources/projects.js:39` |
| PATCH | `/projects/:id` | `central/server/lib/resources/projects.js:47` |
| DELETE | `/projects/:id` | `central/server/lib/resources/projects.js:53` |
| POST | `/projects/:id/key` | `central/server/lib/resources/projects.js:61` |
| PUT | `/projects/:id` | `central/server/lib/resources/projects.js:71` |
| GET | `/projects/:projectId/forms/:xmlFormId/public-links` | `central/server/lib/resources/public-links.js:18` |
| POST | `/projects/:projectId/forms/:xmlFormId/public-links` | `central/server/lib/resources/public-links.js:24` |
| GET | `/projects/:projectId/forms/:xmlFormId/public-links/:id` | `central/server/lib/resources/public-links.js:40` |
| PATCH | `/projects/:projectId/forms/:xmlFormId/public-links/:id` | `central/server/lib/resources/public-links.js:49` |
| DELETE | `/projects/:projectId/forms/:xmlFormId/public-links/:id` | `central/server/lib/resources/public-links.js:63` |
| GET | `/roles` | `central/server/lib/resources/roles.js:14` |
| GET | `/roles/:id` | `central/server/lib/resources/roles.js:16` |
| POST | `/sessions` | `central/server/lib/resources/sessions.js:22` |
| GET | `/sessions/restore` | `central/server/lib/resources/sessions.js:45` |
| DELETE | `/sessions/current` | `central/server/lib/resources/sessions.js:67` |
| DELETE | `/sessions/:token` | `central/server/lib/resources/sessions.js:74` |
| GET | `path` | `central/server/lib/resources/submissions.js:85` |
| POST | `path` | `central/server/lib/resources/submissions.js:105` |
| POST | ``${base}/submissions`` | `central/server/lib/resources/submissions.js:205` |
| PUT | ``${base}/submissions/:instanceId`` | `central/server/lib/resources/submissions.js:222` |
| POST | `/test/:key/projects/:projectId/forms/:xmlFormId/draft/submissions` | `central/server/lib/resources/submissions.js:271` |
| GET | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/edit` | `central/server/lib/resources/submissions.js:293` |
| PATCH | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId` | `central/server/lib/resources/submissions.js:311` |
| DELETE | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId` | `central/server/lib/resources/submissions.js:319` |
| POST | `/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/restore` | `central/server/lib/resources/submissions.js:327` |
| GET | ``${base}.csv.zip`` | `central/server/lib/resources/submissions.js:412` |
| POST | ``${base}.csv.zip`` | `central/server/lib/resources/submissions.js:414` |
| GET | ``${base}.csv`` | `central/server/lib/resources/submissions.js:417` |
| POST | ``${base}.csv`` | `central/server/lib/resources/submissions.js:419` |
| GET | `base` | `central/server/lib/resources/submissions.js:425` |
| GET | ``${base}/keys`` | `central/server/lib/resources/submissions.js:433` |
| GET | ``${base}/submitters`` | `central/server/lib/resources/submissions.js:438` |
| GET | ``${base}/:instanceId/audits`` | `central/server/lib/resources/submissions.js:443` |
| GET | ``${base}/:instanceId.xml`` | `central/server/lib/resources/submissions.js:466` |
| GET | ``${base}/:instanceId`` | `central/server/lib/resources/submissions.js:472` |
| GET | ``${base}/:instanceId/attachments`` | `central/server/lib/resources/submissions.js:479` |
| GET | ``${base}/:instanceId/attachments/:name`` | `central/server/lib/resources/submissions.js:483` |
| POST | ``${base}/:instanceId/attachments/:name`` | `central/server/lib/resources/submissions.js:489` |
| DELETE | ``${base}/:instanceId/attachments/:name`` | `central/server/lib/resources/submissions.js:528` |
| DELETE | ``${base}/:rootId/versions/:instanceId/attachments/:name`` | `central/server/lib/resources/submissions.js:541` |
| GET | ``${base}/:rootId/versions`` | `central/server/lib/resources/submissions.js:559` |
| GET | ``${base}/:rootId/versions/:instanceId${ext}`` | `central/server/lib/resources/submissions.js:569` |
| GET | ``${base}/:rootId/versions/:instanceId/attachments`` | `central/server/lib/resources/submissions.js:581` |
| GET | ``${base}/:rootId/versions/:instanceId/attachments/:name`` | `central/server/lib/resources/submissions.js:590` |
| GET | ``${base}/:rootId/diffs`` | `central/server/lib/resources/submissions.js:603` |
| PUT | `/user-preferences/project/:projectId/:propertyName` | `central/server/lib/resources/user-preferences.js:30` |
| DELETE | `/user-preferences/project/:projectId/:propertyName` | `central/server/lib/resources/user-preferences.js:38` |
| PUT | `/user-preferences/site/:propertyName` | `central/server/lib/resources/user-preferences.js:46` |
| DELETE | `/user-preferences/site/:propertyName` | `central/server/lib/resources/user-preferences.js:52` |
| GET | `/users` | `central/server/lib/resources/users.js:24` |
| POST | `/users` | `central/server/lib/resources/users.js:36` |
| POST | `/users` | `central/server/lib/resources/users.js:44` |
| POST | `/users/reset/initiate` | `central/server/lib/resources/users.js:59` |
| POST | `/users/reset/verify` | `central/server/lib/resources/users.js:78` |
| PUT | `/users/:id/password` | `central/server/lib/resources/users.js:95` |
| GET | `/users/current` | `central/server/lib/resources/users.js:113` |
| GET | `/users/:id` | `central/server/lib/resources/users.js:125` |
| PATCH | `/users/:id` | `central/server/lib/resources/users.js:132` |
| DELETE | `/users/:id` | `central/server/lib/resources/users.js:158` |

## Client path declarations

Local paths from nested route objects are listed without pretending they are full URLs.

| Path or expression | Source |
| --- | --- |
| `/shared/:token` | `central/client/apps/central/src/routes.js:221` |
| `/load-error` | `central/client/apps/central/src/routes.js:236` |
| `/catalog` | `central/client/apps/central/src/routes.js:247` |
| `/report/:token` | `central/client/apps/central/src/routes.js:251` |
| `/account` | `central/client/apps/central/src/routes.js:262` |
| `login` | `central/client/apps/central/src/routes.js:266` |
| `reset-password` | `central/client/apps/central/src/routes.js:278` |
| `claim` | `central/client/apps/central/src/routes.js:291` |
| `/welcome` | `central/client/apps/central/src/routes.js:307` |
| `/` | `central/client/apps/central/src/routes.js:318` |
| `/forms` | `central/client/apps/central/src/routes.js:327` |
| `/maps` | `central/client/apps/central/src/routes.js:335` |
| `/submissions` | `central/client/apps/central/src/routes.js:344` |
| `/projects` | `central/client/apps/central/src/routes.js:352` |
| `/projects/:projectId([1-9]\d*)` | `central/client/apps/central/src/routes.js:360` |
| `` | `central/client/apps/central/src/routes.js:367` |
| `users` | `central/client/apps/central/src/routes.js:379` |
| `app-users` | `central/client/apps/central/src/routes.js:395` |
| `form-access` | `central/client/apps/central/src/routes.js:411` |
| `entity-lists` | `central/client/apps/central/src/routes.js:432` |
| `merged-datasets` | `central/client/apps/central/src/routes.js:444` |
| `reports` | `central/client/apps/central/src/routes.js:461` |
| `summary` | `central/client/apps/central/src/routes.js:477` |
| `custom-properties` | `central/client/apps/central/src/routes.js:490` |
| `settings` | `central/client/apps/central/src/routes.js:502` |
| `new-form` | `central/client/apps/central/src/routes.js:513` |
| `/projects/:projectId([1-9]\d*)/forms/:xmlFormId` | `central/client/apps/central/src/routes.js:526` |
| `versions` | `central/client/apps/central/src/routes.js:534` |
| `submissions` | `central/client/apps/central/src/routes.js:548` |
| `summary` | `central/client/apps/central/src/routes.js:567` |
| `import` | `central/client/apps/central/src/routes.js:585` |
| `photos` | `central/client/apps/central/src/routes.js:603` |
| `filtered-datasets` | `central/client/apps/central/src/routes.js:621` |
| `charts` | `central/client/apps/central/src/routes.js:641` |
| `verification` | `central/client/apps/central/src/routes.js:659` |
| `public-links` | `central/client/apps/central/src/routes.js:677` |
| `settings` | `central/client/apps/central/src/routes.js:695` |
| `draft` | `central/client/apps/central/src/routes.js:711` |
| `/projects/:projectId([1-9]\d*)/forms/:xmlFormId/submissions/:instanceId` | `central/client/apps/central/src/routes.js:733` |
| `/projects/:projectId([1-9]\d*)/entity-lists/:datasetName` | `central/client/apps/central/src/routes.js:744` |
| `properties` | `central/client/apps/central/src/routes.js:752` |
| `entities` | `central/client/apps/central/src/routes.js:764` |
| `settings` | `central/client/apps/central/src/routes.js:778` |
| `/projects/:projectId([1-9]\d*)/entity-lists/:datasetName/entities/:uuid([0-9a-f-]+)` | `central/client/apps/central/src/routes.js:800` |
| `/users` | `central/client/apps/central/src/routes.js:812` |
| `` | `central/client/apps/central/src/routes.js:818` |
| `/users/:id([1-9]\d*)/edit` | `central/client/apps/central/src/routes.js:839` |
| `/account/edit` | `central/client/apps/central/src/routes.js:850` |
| `/field-data` | `central/client/apps/central/src/routes.js:859` |
| `` | `central/client/apps/central/src/routes.js:865` |
| `operations` | `central/client/apps/central/src/routes.js:873` |
| `form-builder` | `central/client/apps/central/src/routes.js:874` |
| `catalog` | `central/client/apps/central/src/routes.js:875` |
| `analysis` | `central/client/apps/central/src/routes.js:876` |
| `explore` | `central/client/apps/central/src/routes.js:878` |
| `review` | `central/client/apps/central/src/routes.js:887` |
| `cleaning` | `central/client/apps/central/src/routes.js:896` |
| `templates` | `central/client/apps/central/src/routes.js:908` |
| `team` | `central/client/apps/central/src/routes.js:920` |
| `cases` | `central/client/apps/central/src/routes.js:929` |
| `cases/:id` | `central/client/apps/central/src/routes.js:938` |
| `assignments` | `central/client/apps/central/src/routes.js:947` |
| `report` | `central/client/apps/central/src/routes.js:956` |
| `dhis2` | `central/client/apps/central/src/routes.js:965` |
| `media` | `central/client/apps/central/src/routes.js:977` |
| `organizations` | `central/client/apps/central/src/routes.js:989` |
| `integrations` | `central/client/apps/central/src/routes.js:1005` |
| `webhooks` | `central/client/apps/central/src/routes.js:1017` |
| `backups` | `central/client/apps/central/src/routes.js:1021` |
| `/system` | `central/client/apps/central/src/routes.js:1036` |
| `audits` | `central/client/apps/central/src/routes.js:1042` |
| `config` | `central/client/apps/central/src/routes.js:1054` |
| `analytics` | `central/client/apps/central/src/routes.js:1068` |
| `/dl/projects/:projectId([1-9]\d*)/forms/:xmlFormId/submissions/:instanceId/attachments/:attachmentName` | `central/client/apps/central/src/routes.js:1090` |
| `/:_(.*)` | `central/client/apps/central/src/routes.js:1100` |

## Duplicate review

The static scan reports two `POST /users` declarations. Source review confirms mutually exclusive `oidc.isEnabled()` branches in `users.js`; this is an intentional authentication-mode alternative, not two simultaneously registered handlers. No static Field Data route collision was found. Dynamic route expressions and wildcard overlaps still need runtime review.
