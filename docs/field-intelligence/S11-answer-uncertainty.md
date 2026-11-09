# Explicit answer uncertainty

The form builder can add an optional uncertainty follow-up to a supported, optional answer question. Choose **Add uncertainty follow-up** on the question; the builder adds two ordinary survey questions immediately after it and opens the advanced builder for review. The original question is unchanged.

The first follow-up records the respondent's own assessment: certain, estimate, unsure, declined to answer, or declined to describe certainty. Certain and estimate require an original answer; declined to answer requires it to be blank. An optional explanation is shown for estimates, uncertainty, and declined responses. Collectors must not guess the respondent's assessment. The added fields remain optional and can be edited or removed before the usual validation and publishing steps.

Generation supports root-level text, number, date, time, and choice questions that are optional, unconstrained, and editable. It can copy a simple equality or inequality condition on an earlier root-level answer; other conditions require manual authoring. Review wording, translations, question order, and relevance before publishing. If the original question or its condition is subsequently changed, review the follow-up references and logic too: they do not automatically synchronize.

These fields record an explicit response; they do not infer confidence, calculate a probability, calibrate assessments, or establish semantic equivalence across forms. Compilation and automated tests do not replace the deferred field and device pilot.
