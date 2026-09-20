-- Central's own _impliedActees + can() query, copied verbatim from
-- lib/model/query/auth.js, parameterised by actor display name and actee.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION can(who text, target text, verb text) RETURNS boolean AS $$
  WITH RECURSIVE implied(id) AS (
    (SELECT target::varchar) UNION
    (SELECT unnest(ARRAY[ parent, species ]) FROM actees
      JOIN implied ON implied.id=actees.id))
  SELECT EXISTS (
    SELECT 1 FROM assignments
      INNER JOIN implied ON implied.id=assignments."acteeId"
      INNER JOIN (SELECT id FROM roles WHERE verbs ? verb) AS role
        ON role.id=assignments."roleId"
      WHERE "actorId"=(SELECT id FROM actors WHERE "displayName"=who));
$$ LANGUAGE sql;

SELECT
  'A-manager reaches own project'  AS check, can('Alice at A','proj-a-actee','form.read') AS got, true AS want
UNION ALL SELECT
  'A-manager BLOCKED from B project', can('Alice at A','proj-b-actee','form.read'), false
UNION ALL SELECT
  'B-manager reaches own project', can('Bob at B','proj-b-actee','form.read'), true
UNION ALL SELECT
  'B-manager BLOCKED from A project', can('Bob at B','proj-a-actee','form.read'), false
UNION ALL SELECT
  'site admin still reaches A (grant not lost)', can('Site admin','proj-a-actee','form.read'), true
UNION ALL SELECT
  'site admin still reaches B', can('Site admin','proj-b-actee','form.read'), true
UNION ALL SELECT
  'A-manager BLOCKED from B organization itself', can('Alice at A','org-b-actee','form.read'), false
UNION ALL SELECT
  'A-manager cannot submit-delete beyond role verbs', can('Alice at A','proj-a-actee','not.a.verb'), false;
