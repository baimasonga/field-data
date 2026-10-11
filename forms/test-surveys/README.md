# Test survey forms

Four XLSForms for testing Field Data end to end. They are realistic but are
**test material, not validated survey instruments**: every form title starts
with "Test:" and every form opens with a note saying so. Place names are
Sierra Leone districts; amounts are in New Leones (NLe).

| File | Form ID | What it covers |
| --- | --- | --- |
| `fd_test_agriculture.xlsx` | `fd_test_agriculture` | Farm household: farmer, crops, a repeat of plots (count set by an answer, crop list filtered to the crops chosen, optional boundary shape), last season's harvest and sales, inputs, pests, extension visits, photo. |
| `fd_test_census.xlsx` | `fd_test_census` | Household census: household roster repeat with age-dependent questions (marital status from 12, schooling 3–30, education from 5, activity from 10, birth registration under 5), exactly-one-head check, dwelling, water, sanitation, lighting, births and deaths. |
| `fd_test_census_backcheck.xlsx` | `fd_test_census_backcheck` | A 5-minute revisit of a census household: size, head's sex and age, water, toilet. Use it with the census form to test back-checks. |
| `fd_test_health.xlsx` | `fd_test_health` | Health facility assessment: facility details, staff on payroll and present, services, power, water, cold chain with a temperature warning, stock of 8 tracer items, last month's register totals with malaria test positivity. |

Every form has a consent question (answering "No" skips the interview), an
area ID in a fixed format, and one GPS point at the start, followed by
`start`, `end`, `today`, `deviceid` and `username` metadata.

## Built-in checks to try

| Form | Enter this | Expected |
| --- | --- | --- |
| all | an ID such as `FARM-12`, `HH-12` or `HF-12` | rejected; formats are `FARM-0001`, `HH-000001`, `HF-0001` |
| all | phone `76123456` | rejected; 9 digits starting with 0 (`076123456`) |
| agriculture | sold 150 kg of a 100 kg harvest | rejected |
| agriculture | pests "None" together with another pest | rejected |
| agriculture | plot count 3 | three plot entries; total area is summed |
| census | a roster with no head, or two | "Roster complete" cannot be confirmed |
| census | a member aged 3 | no marital status or activity; birth registration asked |
| health | more staff present than on payroll | rejected |
| health | more malaria positives than tests, or more tests than outpatient visits | rejected |
| health | facility closed today | staff, services, stock and register sections skipped |
| health | fridge at 12 °C | warning shown |

## Field Data features to exercise

- **Survey doctor and simulation (Draft page):** all four forms report no
  findings. The simulator reports the ID and phone questions as "constraint
  never met", because random text cannot match a format; this is expected.
- **Location evidence:** each form's first geopoint is the one checked. Submit
  some with poor accuracy (over 100 m), some outside the project area, and two
  with identical coordinates.
- **Answer contradictions:** these forms deliberately leave some combinations
  unchecked on the device, so you can write rules for them, for example:
  - health: a "Government" facility with no staff on the payroll; immunization offered but power "None";
  - agriculture: an irrigated plot and fertilizer "No" with a large harvest;
  - census: rooms used for sleeping greater than household size.
- **Identity reuse:** use `household_id`, `farm_id` or `facility_id` as a key,
  with `district` or the farmer, respondent or facility name as fields that
  should not differ. Submitting the same ID twice raises a finding.
- **Near duplicates and collusion groups:** submit a few nearly identical
  interviews from different collectors.
- **Asset passports, freshness, merge, split and duplicates:** farm and
  facility IDs make natural asset external IDs. Register `HF-0001` and
  `hf 0001`, or "Kissy CHC" and "Kisy CHC", to see duplicate suggestions.
- **Back-checks:** sample census submissions, collect
  `fd_test_census_backcheck` for the same `household_id`, and map the shared
  fields (`hh_size`, `water_source`, `toilet`, and head's sex and age against
  roster member 1) to see agreement.

## Rebuilding

The spreadsheets are generated; edit `build.py`, not the `.xlsx` files:

```sh
python3 build.py
```

Each form was checked with the deployment's form compiler (pyxform 4.5.0 with
ODK Validate: no errors or warnings), the Field Data survey doctor (no
findings) and simulator, and the Web Forms engine (the checks in the table
above).
