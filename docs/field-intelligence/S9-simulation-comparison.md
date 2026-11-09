# S9: compare draft and published simulations

On the Draft page, **Simulated interviews** offers **Compare with published
version** when a published version exists. It runs the draft first, then the
published version with the same requested interview count and the draft run's
seed. The table shows the share of interviews in which each question path was
shown, including paths present in only one version. Counts use each run's
actual interview count if the simulator's question-visit budget reduces it.

The comparison shows each version and report hash, typical interview length,
and warnings for expressions the simulator could not evaluate. Published
unsupported expressions can be expanded; the draft report remains available
below the comparison. If either form hash or the simulation date changes
during the requests, the comparison is discarded and the user is asked to
refresh. Each existing simulation endpoint independently enforces form-read
permissions and its existing run and form-size bounds.

Equal seeds do not produce paired interviews: different questions or logic
can change the sequence of random draws. Matching paths do not prove matching
meaning. These simulated results are exploratory evidence, not measured field
outcomes or proof of improvement. Historical-version comparison and a portable
JSON report are now provided by [S10](S10-historical-simulation-comparison.md).
Saved server reports and adaptive policies remain separate work.
