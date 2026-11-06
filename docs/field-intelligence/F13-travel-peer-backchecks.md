# F13: travel peer backchecks

An investigation's linked peer case can use an active same-form
`implausible-travel` finding to prepare a neutral visit-timing backcheck. The
travel rule explicitly identifies the earlier record in each consecutive pair.
Existing source, permission, case-revision and ambiguity checks apply; cross-form
travel matches remain excluded. The suggestion does not expose the other record
or its answers, and a withdrawn finding cannot support a new dispatch. Identical
request retries retain the existing backcheck.

The integration suite covers the peer suggestion, reviewed form definition,
dispatch target, withdrawal and retry, alongside the existing access and mapping
regressions. Travel findings remain prompts for human verification, not proof of
misconduct.
