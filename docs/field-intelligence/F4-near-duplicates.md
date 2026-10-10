# F4: near-duplicate submissions

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue). The
thresholds below can be revisited; changing them is a new rule version.

A copied or invented interview often shows itself by matching an earlier one
almost answer for answer: a collector re-submitting a form with a few answers
changed, or two collectors sharing one. F1 checks answers within one
submission and F2 checks declared identity keys; neither notices two
submissions that are the same interview. F4 is the first "similarity signal"
of the fraud-intelligence row: deterministic, explainable, and a reason to
compare two submissions, not a conclusion about anyone.

## The rule

`near-duplicate`, version 1, runs in every integrity run with the other
checks. It needs no configuration.

- **Questions compared**: questions answered once per submission. Left out:
  metadata (start, end, today, device and phone identifiers, instance ID and
  name, audit), media, locations, times and date-times, and questions inside
  repeats (their entries have no order to compare by).
- **Informative questions only**: a question where one answer covers more
  than 80% of the submissions that answered it is not compared, so a form of
  yes/no questions does not make every interview look alike. This is counted
  over distinct submissions, so many copies of one interview do not hide
  themselves by making their own answers common.
- **Answers** are compared after trimming, lower-casing and collapsing
  spaces; the order of a multiple choice does not matter.
- **Similarity** of two submissions: the share of identical answers among the
  informative questions either answered. Each submission must have answered at
  least 8 of them.
- **Finding**: a later submission whose similarity to an earlier one is at
  least 90% is a concern, linked to its closest earlier match (the earliest on
  a tie). One finding per later submission, however many earlier ones it
  matches; the count of the others is in the evidence.
- **Evidence**: the similarity, the numbers compared and identical, the
  questions that differ (paths, at most 20), whether it is an exact copy,
  whether the collector and device are the same, the benign explanations and
  the next step. No answer is stored; reviewers open both submissions.

## Benign explanations (shown with every finding)

- Two members of one household, or a respondent interviewed twice, answering
  the same way.
- The same interview submitted twice, for example a test or a resend.
- A form whose questions leave little room for answers to differ.

## Routing and lifecycle

As other checks: an open concern adds the reason code `near-duplicate` to the
claim version's review case (migration with trigger); a finding no longer
observed by a later run is withdrawn, keeping the reviewer's status and note;
it appears in the project findings inbox (F3) under the family "Similar
answers".

## Limits

- Not run on encrypted forms, or forms with more than 5,000 submissions; the
  run report says why.
- Exact copies are grouped first (one comparison per copy); other candidates
  come from MinHash over (question, answer) pairs, 32 hashes in 8 bands of 4,
  then an exact comparison. At most 500,000 candidate pairs are compared; the
  report says when it stopped short. A form of 5,000 submissions with 40
  questions takes under a second, including one with 2,500 copies of one
  interview.
- With fewer than two distinct submissions answering a question, it is not
  informative; a form of two identical submissions alone is not flagged.

## Not in this slice

Similarity inside repeats, weighting rare answers more than common ones,
collector-level patterns across many pairs (collusion graphs), comparison
across forms, calibrated scores.

## Acceptance

- Unit: compared and excluded questions; normalising; a copy and a near copy
  linked to the closest earlier match; minimum answered questions; a cluster
  counted once per later submission; nothing among independent submissions;
  deterministic results; a large group of exact copies; the candidate cap.
- Integration: a copy from another collector found in the integrity run, with
  the reason code on its review case, in the findings inbox, no answers
  stored, unchanged on re-run, withdrawn once corrected; not run on a form too
  large to compare; migration rollback.
- Browser: the finding's evidence and links on the Verification page; the run
  report, including when the check could not run.
