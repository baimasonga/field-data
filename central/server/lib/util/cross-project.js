// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Listing forms or submissions across every project needs the same question
// answered once per project that Auth.can() answers one actee at a time: may
// this actor do X here? Asking can() in a loop means a query per project, so
// the filter is expressed as SQL the listing joins against.

const { sql } = require('slonik');

// Walks the actee parent chain exactly as Auth.can() does, so a role granted
// on an organization reaches the projects that organization owns, and a role
// granted on '*' or on the 'project' species reaches all of them. Matching
// assignments flatly against projects."acteeId" -- which is what
// Projects.getAllByAuth still does -- sees neither, and an organization member
// would get an empty list rather than their own projects.
//
// Every actee id each Project's actee implies: itself, whatever owns it, and
// the species at each step, which is how a grant on '*' or on 'project'
// reaches a Project it never names. A derived table rather than a correlated
// subquery, so it can be joined from anywhere.
const impliedProjectActees = sql`
(with recursive implied(root, id) as (
  (select p."acteeId"::text, p."acteeId"::text from projects p where p."deletedAt" is null)
  union
  (select implied.root, unnest(ARRAY[actees.parent, actees.species])::text
    from actees join implied on implied.id = actees.id)
) select root, id from implied)`;

// Returns the WITH prefix of a statement: append the query that joins
// `visible` to whatever is being listed.
const visibleProjects = (actorId, verbs) => sql`
with visible as (
  select p.id
  from projects p
  join ${impliedProjectActees} as implied on implied.root = p."acteeId"
  join assignments on assignments."acteeId" = implied.id
    and assignments."actorId" = ${actorId}
  join roles on roles.id = assignments."roleId"
  cross join lateral jsonb_array_elements_text(roles.verbs) as granted(verb)
  where p."deletedAt" is null
  group by p.id
  -- Every verb, not any of them: two roles on the same project can each
  -- supply one half of what the listing needs.
  having array_agg(distinct granted.verb) @> ${sql.array(verbs, 'text')}
)`;

// The actor id Auth carries, or one that matches nothing. An unauthenticated
// request must list nothing rather than everything.
const actorIdOf = (auth) => auth.actor.map((actor) => actor.id).orElse(-1);

module.exports = { impliedProjectActees, visibleProjects, actorIdOf };
