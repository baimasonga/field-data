# K2a: relevance ordering for cited search

Previously, each result group showed only its 20 newest substring matches. An
old asset whose name or external ID exactly matched the query could be omitted
behind newer mentions. Search now orders every authorized match before limiting
each group to 20 results:

1. A whole field value matches the query, ignoring case.
2. A field begins with the query, ignoring case.
3. A field contains the query elsewhere, ignoring case.

The strongest matching field determines the order. Newest records come first
within each class, then the existing stable ID order breaks ties. Assets use
creation time, facts use recording time, and findings/decisions use creation
time. The excerpt identifies the strongest matching field; field declaration
order breaks ties between equal matches within one record.

This is literal text relevance, not confidence in a claim, a learned score, or
an assessment of asset identity. Query length, substring eligibility, citations,
permission checks, deleted-source exclusions, result limits and total counts
remain as documented in K2. Percent, underscore and backslash are literal query
characters. Search still does not read submission answers, translate queries,
find synonyms or invoke a model. No migration or external provider is required.

The API adds `ordering: "literal-relevance@1"`, including for an empty authorized
result. The Review search panel explains the order when that version is returned.
Responses without it retain the previous recency wording, supporting older
servers during rollout. The browser preserves the server's result order.

Acceptance covers an old exact match beyond the former pagination boundary,
stronger matches in secondary fields, prefix versus substring order across all
four groups, stable ties, source citations, literal wildcard characters and the
existing permission/deleted-source checks. Browser coverage checks the ordering
explanation, older-response fallback, result order, citation links and mobile
overflow. Evidence is deterministic ordering, not a claim of semantic quality.
