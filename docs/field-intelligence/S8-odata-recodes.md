# S8: opt-in OData recodes

Append `valueRecodes=true` to a published, unencrypted form's OData submission
table or single-submission URL to apply active reviewed rules. For example:

`/v1/projects/1/forms/example.svc/Submissions?valueRecodes=true`

The caller needs both submission read and form read access. Ordinary OData
requests continue to return stored answers. Rules are loaded once per request;
eligible historical versions receive moved-question rules first and value rules
once afterward. An existing destination answer takes precedence over a moved
answer. Repeat value rules work in repeat tables and expanded records; moved
questions must be outside repeats. Stored submission XML is never changed.

Native OData filters, ordering, counts, and paging operate on stored submissions
before values are recoded for output. Next-page links preserve the opt-in;
navigation links to other tables must have `valueRecodes=true` added separately.
Each page is a separate request and uses the active rules at that time. Avoid
changing rules during a multi-page extraction when a consistent snapshot matters.

OData metadata is unchanged. Unsupported binary and geometry targets are
skipped, as in native CSV. Rules for boolean, date and date-time targets are
rejected, as are nonnumeric replacement values for numeric fields. Draft and
encrypted forms cannot use the overlay. The response is private and not stored
by caches; its ETag includes the active rule snapshot. This interface is not a
recoded-query engine: a filter on stored values is not re-evaluated after the
overlay.
