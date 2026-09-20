\set ON_ERROR_STOP on
-- Which form definition a submission version belongs to.
--
-- form_defs and submission_defs have independent id sequences, and
-- submission_defs."formDefId" is the only thing relating them. A query that
-- compares a submission version's id to form_defs.id therefore matches only
-- where the two numbers happen to coincide -- which they do for the first
-- submission of a fresh deployment, and for nothing after it.
--
-- That is not a hypothetical. It shipped in the Google Sheets delivery target,
-- where it synchronized one row and then failed every delivery afterwards with
-- "The Form has no fields that can be synchronized."
--
-- Run this against a database with the migrations applied. It asserts the
-- shape of the two joins rather than any particular data, so it needs no
-- seeded form.

-- A form, one published definition, two chartable fields.
INSERT INTO actees (id, species) VALUES ('sdj-proj','project');
INSERT INTO projects (name, "acteeId", "createdAt") VALUES ('Join check','sdj-proj',now());
INSERT INTO actees (id, species) VALUES ('sdj-form','form');
INSERT INTO forms ("projectId","xmlFormId","acteeId","createdAt")
  SELECT p.id,'join-check','sdj-form',now() FROM projects p WHERE p."acteeId"='sdj-proj';

INSERT INTO form_schemas DEFAULT VALUES;
-- Literal digests: hash is varchar(32), sha varchar(40), sha256 varchar(64),
-- and stock PostgreSQL has no sha1(). Nothing here reads them.
INSERT INTO form_defs ("formId","schemaId",name,version,hash,sha,sha256,xml,"createdAt")
  SELECT f.id, (SELECT max(id) FROM form_schemas), 'Join check','1',
         repeat('a',32), repeat('b',40), repeat('c',64), '<x/>', now()
  FROM forms f WHERE f."xmlFormId"='join-check';
UPDATE forms SET "currentDefId" = (SELECT max(id) FROM form_defs) WHERE "xmlFormId"='join-check';

INSERT INTO form_fields ("formId","schemaId",path,name,type,"order")
  SELECT f.id, (SELECT max(id) FROM form_schemas), '/district','district','string',0
  FROM forms f WHERE f."xmlFormId"='join-check';
INSERT INTO form_fields ("formId","schemaId",path,name,type,"order")
  SELECT f.id, (SELECT max(id) FROM form_schemas), '/hh_size','hh_size','int',1
  FROM forms f WHERE f."xmlFormId"='join-check';

-- Three submissions against that one definition. Their submission_defs ids
-- are whatever the sequence gives, and are not the form_defs id.
INSERT INTO submissions ("formId","instanceId","submitterId","createdAt",draft)
  SELECT f.id, 'uuid:sdj-'||n, NULL, now(), false
  FROM forms f, generate_series(1,3) n WHERE f."xmlFormId"='join-check';
INSERT INTO submission_defs ("submissionId","formDefId","instanceId",xml,"submitterId","createdAt",current,root)
  SELECT s.id, (SELECT max(id) FROM form_defs), s."instanceId",
         '<data><district>Bombali</district><hh_size>6</hh_size></data>',
         NULL, now(), true, true
  FROM submissions s WHERE s."instanceId" LIKE 'uuid:sdj-%';

-- The shipped join: form_defs.id compared to a submission_defs id.
SELECT 'shipped join finds fields for every submission' AS check,
  (SELECT count(DISTINCT sd.id) FROM submission_defs sd
    WHERE sd."instanceId" LIKE 'uuid:sdj-%'
      AND EXISTS (
        SELECT 1 FROM form_fields ff
        JOIN form_defs fd ON fd.id = sd.id AND fd."schemaId" = ff."schemaId"
        JOIN forms f ON f.id = ff."formId"
        WHERE f."xmlFormId" = 'join-check'))::int AS got,
  3 AS want;

-- The correct join, through the foreign key that actually relates them.
SELECT 'formDefId join finds fields for every submission' AS check,
  (SELECT count(DISTINCT sd.id) FROM submission_defs sd
    WHERE sd."instanceId" LIKE 'uuid:sdj-%'
      AND EXISTS (
        SELECT 1 FROM form_fields ff
        JOIN form_defs fd ON fd.id = sd."formDefId" AND fd."schemaId" = ff."schemaId"
        JOIN forms f ON f.id = ff."formId"
        WHERE f."xmlFormId" = 'join-check'))::int AS got,
  3 AS want;

-- And the reason the first one ever looked like it worked: the id spaces
-- overlap at the low numbers a fresh deployment starts from.
SELECT 'a submission_defs id is not a form_defs id' AS check,
  (SELECT count(*) FROM submission_defs sd
    WHERE sd."instanceId" LIKE 'uuid:sdj-%'
      AND sd.id = sd."formDefId")::int AS "coinciding ids",
  3 AS "submissions in this check";
