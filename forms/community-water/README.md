# Bo town water and sanitation pilot

Requested for **Offline readiness check 19307c7e-3b37-4964-bd30-73ea4fe0eb36**.
This is a persistent user project, not a disposable verification fixture. Do not
remove it as readiness cleanup.

The editable XLSForm and ODK-validated XForm cover consent, reporting unit,
Bo town eligibility, fixed Bo district/town, neighbourhood/site reference, water source/functionality,
reported collection time, year-round access, storage, sanitation, handwashing and
service priorities. Location and photo are optional; location has separate consent.
No respondent name or phone number is requested. This is a pilot instrument, not
a nationally validated statistical survey or water-quality test.

Run `python build.py` here to regenerate the spreadsheet (openpyxl required).
Compile using pyxform with ODK Validate before publishing. Form ID:
`sl_community_water_service`, version `2026101402`.

The manual installation workflow targets only the exact named active project,
creates this published form if absent, verifies it and closes its session. It does
not overwrite existing different forms or drafts, create/delete projects, assign App Users
or change unrelated form settings. A repeated run confirms the same existing form.

The known previous version `2026101401` is revised through a native draft and
publication, retaining the form ID, versions and submissions. Other settlements
in Bo District are excluded: outside-town interviews end without service details.
Eligibility is collector-confirmed, not a GPS boundary validation. Historical
records are not retroactively classified as Bo town observations.

## Concurrent editing protection

Revising the known previous version uses a single `POST /forms/:id/versions`
request with `If-Match: "sha256:…"` from the published form. The server locks the
form, refuses any existing draft or changed publication, compiles and publishes
inside one transaction. Normal draft creation and publication use the same lock.
An older server returns 404 for this endpoint; the installer never falls back to
separate draft writes. An uncertain response is read back, not blindly retried.
Existing user drafts and their draft submissions are not deleted by this path.
