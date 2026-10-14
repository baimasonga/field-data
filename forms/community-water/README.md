# Sierra Leone community water and sanitation pilot

Requested for **Offline readiness check 19307c7e-3b37-4964-bd30-73ea4fe0eb36**.
This is a persistent user project, not a disposable verification fixture. Do not
remove it as readiness cleanup.

The editable XLSForm and ODK-validated XForm cover consent, reporting unit,
Sierra Leone's 16 districts, community/site reference, water source/functionality,
reported collection time, year-round access, storage, sanitation, handwashing and
service priorities. Location and photo are optional; location has separate consent.
No respondent name or phone number is requested. This is a pilot instrument, not
a nationally validated statistical survey or water-quality test.

Run `python build.py` here to regenerate the spreadsheet (openpyxl required).
Compile using pyxform with ODK Validate before publishing. Form ID:
`sl_community_water_service`, version `2026101401`.

The manual installation workflow targets only the exact named active project,
creates this published form if absent, verifies it and closes its session. It does
not overwrite existing different forms, create/delete projects, assign App Users
or change unrelated form settings. A repeated run confirms the same existing form.
