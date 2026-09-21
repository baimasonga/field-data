\set ON_ERROR_STOP on
-- Which Projects a cross-project listing may show, asked of the query the
-- listings actually run.
--
-- Run seed-two-tenants.js first, then this. Every row must read 'ok'.
--
-- lib/util/cross-project.js builds this walk for /v1/field-data/forms,
-- /v1/field-data/submissions and, since the flat match was replaced,
-- Projects.getAllByAuth behind /v1/projects. It is copied here verbatim,
-- parameterised by actor and verb list, because the property under test is the
-- recursive walk over actees.parent and actees.species: a role granted on an
-- organization has to reach the Projects that organization owns. The flat
-- match it replaced named the two species that happen to sit above a Project
-- and stopped there, so an organization member's Project list came back
-- empty.

create or replace function visible_projects(actor_id integer, required_verbs text[])
returns table (id integer) as $$
  with recursive implied(root, id) as (
    (select p."acteeId"::text, p."acteeId"::text from projects p where p."deletedAt" is null)
    union
    (select implied.root, unnest(ARRAY[actees.parent, actees.species])::text
      from actees join implied on implied.id = actees.id)
  )
  select p.id
  from projects p
  join implied on implied.root = p."acteeId"
  join assignments on assignments."acteeId" = implied.id
    and assignments."actorId" = actor_id
  join roles on roles.id = assignments."roleId"
  cross join lateral jsonb_array_elements_text(roles.verbs) as granted(verb)
  where p."deletedAt" is null
  group by p.id
  having array_agg(distinct granted.verb) @> required_verbs;
  -- Named required_verbs, not verbs: roles.verbs would capture the name.
$$ language sql stable;

with person(name, id) as (
  select a."displayName", a.id from actors a
  where a."displayName" in ('Site Admin','Owner A','Viewer A','Manager B','Outsider')
),
expected(name, project, verbs, want) as (values
  -- A role granted on an organization reaches the Project that organization
  -- owns. This is the whole point: a flat match sees nothing here.
  ('Owner A',   'A field work', ARRAY['project.read','form.list'], true),
  ('Owner A',   'B field work', ARRAY['project.read','form.list'], false),
  ('Viewer A',  'A field work', ARRAY['project.read','form.list'], true),
  ('Viewer A',  'A field work', ARRAY['project.read','submission.list','submission.read'], true),
  ('Viewer A',  'B field work', ARRAY['project.read','submission.list','submission.read'], false),
  ('Manager B', 'B field work', ARRAY['project.read','form.list'], true),
  ('Manager B', 'A field work', ARRAY['project.read','form.list'], false),
  -- A site administrator is granted on '*', which the same walk reaches.
  ('Site Admin','A field work', ARRAY['project.read','form.list'], true),
  ('Site Admin','B field work', ARRAY['project.read','submission.list','submission.read'], true),
  -- Somebody with no grant at all sees neither.
  ('Outsider',  'A field work', ARRAY['project.read','form.list'], false),
  ('Outsider',  'B field work', ARRAY['project.read','form.list'], false),
  -- Every verb, not any of them: a viewer may not create a Form, so a listing
  -- that asked for form.create would have to leave the Project out.
  ('Viewer A',  'A field work', ARRAY['project.read','form.create'], false)
)
select case when got = want then 'ok'
            else 'FAIL: ' || name || ' / ' || project || ' / ' ||
                 array_to_string(verbs, '+') || ' got ' || got || ' want ' || want end as result
from (
  select e.name, e.project, e.verbs, e.want,
    exists (select 1 from visible_projects(p.id, e.verbs) v
            join projects pr on pr.id = v.id where pr.name = e.project) as got
  from expected e join person p on p.name = e.name
) checked
order by name, project, array_to_string(verbs, '+');

drop function visible_projects(integer, text[]);
