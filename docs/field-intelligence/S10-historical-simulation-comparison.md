# S10: historical simulation comparisons

On the Draft page, **Simulated interviews → Compare versions** can compare the
current draft or any published version against any published version. When no
draft exists, the current published form and historical versions can be
compared. Versions without a version string are supported. All requests use the
existing form-read permissions, simulator run budget and form-size limits.

The comparison uses the same seed and requested interview count, displays
each version's actual run count, and rejects mismatched form hashes, version
identifiers, simulator versions or simulated dates. A path-level table shows
visibility; a second table shows answered and constraint-not-met rates. The
denominator is the actual number of simulated interviews in that version, not
the number shown. Missing paths are labelled rather than treated as zero.
Unsupported expressions in each report and run-budget reductions are explicit.

**Download comparison JSON** saves both complete simulator reports, their
hashes and limitations locally. It does not save results to the server or
contain real submission answers. Equal seeds do not pair interviews because
different logic can change random draws. Matching paths do not establish
equivalent meaning, and these synthetic results cannot establish field
effectiveness. Saved server reports, adaptive policies and field evaluation
remain separate work.
