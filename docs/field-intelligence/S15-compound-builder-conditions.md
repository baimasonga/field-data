# Compound conditions in visual authoring

Under **Build a condition**, choose **All conditions must match (AND)** or
**Any condition may match (OR)** to combine a new condition with the question's
existing visibility, required, constraint or choice-filter expression. Both
expressions are parenthesized so existing AND/OR precedence is retained. Applying
another condition combines with the current expression, including manual edits.

**Replace existing condition** remains the default. Switching the target
expression resets this choice to replace. Calculation and repeat-count targets
support replacement only. Without an existing expression, combining simply adds
the new condition. Existing required flags use XPath boolean expressions when
combined; a blank or boolean false flag is treated as no existing condition.

Numeric values must be valid numeric literals; text values are quoted as XPath
strings, including text containing both kinds of quotes. A field renamed or
removed after selection must be selected again before applying a condition.
Errors retain the previous expression.

This edits ordinary XLSForm logic. It does not evaluate expressions, prove
reachability, approve an adaptive policy or replace compiler and device testing.
Authors should inspect the resulting expression before publishing. Diagnostic
tests cover grouping, literals, required flags and rejected inputs. Browser tests
cover AND/OR authoring, stale-field rejection, required flags, calculation
replacement and the existing import/condition workflow.
