# Question removal impact preview

In advanced Form Builder authoring, a question or group with incoming
expression references shows **Removal affects … expression references**. Open
the preview to see each referring question, expression field and referenced name.
Select a referring question to focus it before editing its logic.

For groups and repeats, the preview includes references to descendants. References
from inside the removed subtree are excluded because those questions disappear
together. Ambiguous references are included conservatively even when another
question with the same name would remain. Counts are reference occurrences, not
distinct questions. The preview updates when names and expressions change.

Top-level removal remains reversible using **Undo removal**. Inside a group or
repeat, **Undo child removal** restores that parent's most recently removed child
at its original position (or the end if the remaining list became shorter),
including its full subtree and metadata. Undo history is temporary editor state;
loading another definition, reloading the page or removing the parent clears it.
After removal, existing missing
or ambiguous reference diagnostics control compilation and draft creation. The
preview does not approve deletion, change expressions or automatically repair
them. The same preview is available for nested children at every depth. It follows explicit `${name}`
references in visibility, required, constraint, calculation, choice-filter and
repeat-count expressions; it does not resolve XPath, external data, entity
configuration, or other dependencies. Compiler validation and device testing are
still required.

Diagnostic tests cover descendant targets, internal-reference exclusion, multiple
expression fields and ambiguous targets. Browser tests cover navigation to the
referring question, root and nested removal, blocked compilation, subtree
restoration and clearing child undo state when a definition is reopened.
