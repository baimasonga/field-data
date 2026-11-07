# S7: moved questions in native CSV ZIP

The existing opt-in **Download recoded CSV ZIP** action now applies active,
reviewed moved-question rules as well as value rules. For an eligible historical
form version, the export fills an empty current question from its earlier XML
path and then applies its value mapping once. A present current answer takes
precedence. Missing or empty source answers remain empty. Current-version answers,
stored XML, ordinary downloads, and native filters remain unchanged.

Moved-question rules are limited by the existing rule workflow to questions
outside repeats. Unsupported destination fields, including geometry and binary
fields, are listed as skipped in the manifest. Repeat-table value recodes retain
their existing behavior. OData and plain CSV recoding are not included.

The ZIP manifest uses `native-csv-recodes@2` and retains the frozen rule list,
source/options and skipped reasons. The method version is included in its
fingerprint, so ETags differ from older exports even when the rules have not
changed. Rules are loaded and validated before row streams open; overlapping
moved rules for the same version and destination are rejected. The existing
`valueRecodes=true` API parameter is retained for compatibility.

PostgreSQL integration tests cover historical and current versions, existing
and missing destinations, entity-split XML text, move-then-value ordering,
unchanged XML, filters, repeat values, manifests, permissions and ETags. Unit
tests cover rule ambiguity and the versioned fingerprint.
