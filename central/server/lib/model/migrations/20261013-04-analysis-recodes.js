// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE INDEX IF NOT EXISTS field_data_export_recodes_frozen_form_path ON field_data_export_recodes ("formId", path);
CREATE OR REPLACE FUNCTION field_data_analysis_recode(
  original jsonb, source_xml text, source_version text, source_form integer,
  visible_paths text[], multiple_paths text[], frozen_rules uuid[], allow_moved boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb := original; rule record; answer text;
BEGIN
  FOR rule IN SELECT r.* FROM field_data_export_recodes r
    WHERE r.id = ANY(frozen_rules) AND r."formId" = source_form
      AND source_version = ANY(r.versions) AND r.path = ANY(visible_paths)
    ORDER BY CASE r.kind WHEN 'path' THEN 0 ELSE 1 END, r."createdAt", r.id
  LOOP
    answer := result ->> rule.path;
    IF rule.kind = 'path' THEN
      IF allow_moved AND (answer IS NULL OR answer = '') THEN
        SELECT btrim(value) INTO answer FROM XMLTABLE('/*' PASSING (source_xml::xml) COLUMNS value text PATH ('(/*' || rule."fromPath" || '/text())[1]')) x;
        result := jsonb_set(result, ARRAY[rule.path], coalesce(to_jsonb(answer), 'null'::jsonb), true);
      END IF;
    ELSIF answer IS NOT NULL AND answer <> '' THEN
      IF rule.path = ANY(multiple_paths) THEN
        SELECT coalesce(string_agg(coalesce(rule."values" ->> token, token), ' ' ORDER BY position), '') INTO answer
          FROM regexp_split_to_table(answer, '[[:space:]]+') WITH ORDINALITY parts(token, position) WHERE token <> '';
      ELSE
        answer := coalesce(rule."values" ->> answer, answer);
      END IF;
      result := jsonb_set(result, ARRAY[rule.path], to_jsonb(answer), true);
    END IF;
  END LOOP;
  RETURN result;
END; $$`);
const down = async db => db.raw('DROP FUNCTION IF EXISTS field_data_analysis_recode(jsonb, text, text, integer, text[], text[], uuid[], boolean); DROP INDEX IF EXISTS field_data_export_recodes_frozen_form_path');
module.exports = { up, down };
