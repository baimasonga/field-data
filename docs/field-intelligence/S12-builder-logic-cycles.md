# Form Builder circular logic warnings

In advanced authoring, **Expression dependencies** warns about possible cycles among question visibility (`relevant`) and calculation expressions. Open the section to see each group of questions and select a question to focus it. The warning updates as expressions and question names change. It is advisory: the ordinary compiler validation and publishing workflow remain required.

The warning follows explicit `${question}` references and can overstate a problem when an expression branch is never reached. It does not evaluate expressions or establish reachability. Names that occur more than once are ambiguous and excluded from cycle analysis; fix duplicate and missing names using the existing diagnostics and compiler. Constraints, required expressions, choice filters, repeat counts, external data and runtime behaviour are outside this check. Review logic within nested groups and repeats in the compiled form and on devices.

The dependency list now distinguishes missing references from ambiguous references
whose name matches multiple questions, including questions inside nested groups.
Each ambiguous reference links to all matching questions so authors can rename
them and update their expressions. Compiler validation, draft creation and builder
spreadsheet download are unavailable until referenced names resolve uniquely.
Warnings update immediately after repairs. This checks explicit `${name}`
references only; it does not resolve XPath scope or replace compiler validation.
