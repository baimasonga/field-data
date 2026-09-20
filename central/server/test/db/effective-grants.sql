-- Every (actor, project) pair that can read a form, computed through Central's
-- own implied-actee walk. Run this before the organizations migration and
-- again after; the two outputs must be identical.
--
-- This is the assertion that matters for that migration. "The table was
-- created" says nothing; "nobody gained or lost access" is the whole claim.
SELECT ac."displayName" || ' -> ' || p.name AS grant
FROM assignments asg
JOIN actors ac ON ac.id = asg."actorId"
JOIN roles r ON r.id = asg."roleId", projects p
WHERE r.verbs ? 'form.read'
  AND EXISTS (
    WITH RECURSIVE implied(id) AS (
      (SELECT p."acteeId"::varchar) UNION
      (SELECT unnest(ARRAY[parent, species]) FROM actees
        JOIN implied ON implied.id = actees.id))
    SELECT 1 FROM implied WHERE implied.id = asg."acteeId")
ORDER BY 1;
