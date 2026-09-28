\set ON_ERROR_STOP on
-- Cross-tenant isolation, asked of Central's own can() query.
--
-- Run seed-two-tenants.js first, then can.sql, then this. Every row must read
-- 'ok'. Two organizations, each owning a Project with a Form and Submissions,
-- and five people: a site administrator, an organization's owner and viewer,
-- the other organization's manager, and somebody with no grant at all.
--
-- This is the claim organizations rest on, and it holds. What it does not
-- cover is whether the routes ask can() at all -- see the endpoint matrix in
-- the README, which is where the project listing turned out not to.
with q(person, target, verb, want) as (values
  -- An organization's owner reaches its Project and its Form.
  ('Owner A','A field work','project.read', true),
  ('Owner A','A field work','form.update', true),
  ('Owner A','A field work','submission.read', true),
  -- And reaches nothing of the other organization's.
  ('Owner A','B field work','project.read', false),
  ('Owner A','B field work','form.update', false),
  ('Owner A','B field work','submission.read', false),
  ('Owner A','B field work','submission.list', false),
  -- A viewer granted on the organization reads its Project, not the other.
  ('Viewer A','A field work','submission.read', true),
  ('Viewer A','B field work','submission.read', false),
  -- And a viewer is a viewer: no writing, even at home.
  ('Viewer A','A field work','form.update', false),
  ('Viewer A','A field work','project.update', false),
  -- The other organization's manager, mirrored.
  ('Manager B','B field work','project.update', true),
  ('Manager B','A field work','project.read', false),
  ('Manager B','A field work','submission.read', false),
  -- Somebody with no grant at all reaches neither.
  ('Outsider','A field work','project.read', false),
  ('Outsider','B field work','project.read', false),
  -- A site administrator still reaches both, through the species chain the
  -- organizations migration put in place.
  ('Site Admin','A field work','project.read', true),
  ('Site Admin','B field work','project.read', true)
)
select q.person, q.target, q.verb,
  can(q.person, p."acteeId", q.verb) as got, q.want,
  case when can(q.person, p."acteeId", q.verb) = q.want then 'ok' else '*** MISMATCH ***' end as result
from q join projects p on p.name = q.target
order by q.person, q.target, q.verb;
