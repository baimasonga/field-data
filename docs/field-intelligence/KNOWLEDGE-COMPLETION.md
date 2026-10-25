# Knowledge implementation completion contract

The Knowledge area is the exclusive current implementation priority. Completion
means working API and UI workflows, permission/failure coverage and passing CI
for every item below; separate field evaluation must not be represented as code
completion. Earlier K1–K9 features remain part of the regression baseline.

- [x] **Asset geography:** current/historical cited asset points; named polygon
  areas, overlap/outside/boundary-uncertainty states; map/table selection and
  reproducible GeoJSON/snapshot exports; unavailable/stale/source-revoked states.
- [x] **Image-content comparison:** verified photo bytes plus local perceptual
  comparison for human identity review; low-information/decoding limits; no
  automatic identity assertion or merge; source/permission and retry coverage.
- [x] **Answer and semantic retrieval:** scoped current submission answers and
  asset facts; literal and corpus-derived latent-semantic ranking with citations,
  explicit corpus bounds/coverage; no cross-project or unreadable-source model
  statistics, stale indexes or external data transfer.
- [x] **Decision projections:** saved/versioned shared definitions, explainable
  predicate rules/actions/priorities, historical cutoffs, current permissions,
  reproducible snapshot exports and rebuilding after evidence/ownership changes.
- [x] **Causal contracts:** declared DAG/treatment/outcome/adjustments/estimand and
  assumptions; graph/backdoor/timing/overlap/missingness diagnostics; conditional
  adjusted binary-treatment numeric-outcome ATE when identification and data
  conditions hold, otherwise explicit withholding; saved history and cited exports.
- [x] **Acceptance:** optimistic revisions, idempotency, invalid/bounded inputs,
  deleted/revoked sources, late evidence, historical ownership/undo, mobile and
  keyboard/table alternatives, no fabricated model or causal conclusions.

Methods and limits are part of the feature contract. Corpus-derived semantics
are not an externally pretrained language model. Perceptual similarity is not
identity proof. Observational causal interpretation requires declared assumptions
that software cannot empirically certify. Device/data/model effectiveness studies
remain separate from software acceptance, consistent with the deferred pilot.

## Software acceptance record

All five workflows passed local acceptance on 2026-10-25: 1,969 server unit
tests, nine Knowledge API scenarios, 21 existing asset/search API regressions,
seven Knowledge browser scenarios, server/client lint and the production build.
The final-head Field Data validation and Full stability validation gates and
production deployment remain required release checks. See
[Knowledge workspace methods and user guide](KNOWLEDGE-WORKSPACE.md).

Completion is scoped to the methods and bounds documented there. There is no
claim of calibrated identity probabilities, general language understanding,
automatic causal discovery or empirically verified causal assumptions. The
remaining seven product areas retain their separate implementation backlogs.
