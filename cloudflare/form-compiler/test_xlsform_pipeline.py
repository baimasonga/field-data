"""Real XLSForm compilation and the validation policy around it.

The older tests in test_app.py mock pyxform, so none of them could notice that a
runtime without Java cannot compile anything. These do not mock the conversion:
they run pyxform and ODK Validate. Set REQUIRE_JAVA=1 (CI does) so a missing
JVM fails the run instead of skipping it.
"""

import os
import shutil
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

import app as compiler
from xlsform_fixtures import (
    household_workbook,
    undefined_reference_workbook,
    unknown_type_workbook,
)

JAVA_MESSAGE = (
    "Form validation failed because Java (8+ required) could not be found. "
    "To fix this, please either: 1) install Java, or 2) run pyxform with the "
    "--skip_validate flag, or 3) add the installed Java to the environment path."
)
POLICY_VARS = ("FORM_COMPILER_SKIP_VALIDATE", "FORM_COMPILER_PERMIT_SKIP_VALIDATE")


def reset_java_cache():
    compiler._java_cache.update(at=0.0, value=None)


def client_with(env=None):
    """A test client whose app reads the policy from `env` and nothing else."""
    cleaned = {k: v for k, v in os.environ.items() if k not in POLICY_VARS}
    cleaned.update(env or {})
    with patch.dict(os.environ, cleaned, clear=True):
        return compiler.create_app().test_client()


def post(client, data, form_id="household"):
    return client.post("/api/v1/convert", data=data, headers={"X-XlsForm-FormId-Fallback": form_id})


def require_java(case):
    reset_java_cache()
    if compiler.java_status()["available"]:
        return
    if os.environ.get("REQUIRE_JAVA"):
        case.fail("Java is required for these tests (REQUIRE_JAVA is set) but is not on PATH")
    case.skipTest("Java is not installed")


class RealCompilationTest(unittest.TestCase):
    """XLSForm in, validated XForm out, with ODK Validate actually running."""

    @classmethod
    def setUpClass(cls):
        require_java(cls)
        cls.client = client_with()
        cls.response = post(cls.client, household_workbook())
        cls.xform = cls.response.json.get("result") or ""

    def test_a_valid_xlsform_compiles_and_is_well_formed(self):
        self.assertEqual(self.response.status_code, 200, self.response.json)
        self.assertIsNone(self.response.json["error"])
        ET.fromstring(self.xform)  # raises if the XForm is not well-formed XML

    def test_skip_logic_survives_compilation(self):
        self.assertRegex(self.xform, r"relevant=\"[^\"]*has_children[^\"]*yes")

    def test_constraints_and_their_messages_survive_compilation(self):
        self.assertIn(". &gt;= 0 and . &lt;= 120", self.xform)
        self.assertIn("Age must be between 0 and 120", self.xform)

    def test_repeat_groups_survive_compilation(self):
        self.assertIn("jr:template", self.xform)
        self.assertRegex(self.xform, r"<repeat[^>]*nodeset=\"/[^\"]*children\"")

    def test_gps_fields_survive_compilation(self):
        self.assertRegex(self.xform, r"type=\"geopoint\"")
        self.assertRegex(self.xform, r"<upload[^>]*>|<input[^>]*ref=\"/[^\"]*location\"")

    def test_the_form_id_comes_from_the_settings_sheet(self):
        self.assertIn('id="household"', self.xform)

    def test_jvm_start_up_notices_are_not_shown_as_form_warnings(self):
        # Deployments sometimes inject JAVA_TOOL_OPTIONS, and the JVM announces it
        # on stderr, which pyxform would report as a warning about the form.
        client = client_with()
        with patch.dict(os.environ, {"JAVA_TOOL_OPTIONS": "-Dfield.data.test=1"}):
            response = post(client, household_workbook())
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(
            [w for w in response.json["warnings"] if "Picked up" in w],
            response.json["warnings"],
        )

    def test_an_undefined_reference_is_an_invalid_xlsform(self):
        response = post(self.client, undefined_reference_workbook(), "broken")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["errorCode"], "invalid-xlsform")
        self.assertIn("no_such_question", response.json["error"])
        self.assertIsNone(response.json["result"])

    def test_an_unknown_question_type_is_an_invalid_xlsform(self):
        response = post(self.client, unknown_type_workbook(), "broken_type")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["errorCode"], "invalid-xlsform")

    def test_an_invalid_form_is_never_waved_through(self):
        # If validation were silently off, every one of these would compile.
        for bad in (undefined_reference_workbook(), unknown_type_workbook()):
            self.assertNotEqual(post(self.client, bad).status_code, 200)


class ValidatorUnavailableTest(unittest.TestCase):
    """No Java is a broken deployment and must read as one, not as a bad form."""

    def setUp(self):
        reset_java_cache()
        self.addCleanup(reset_java_cache)
        self.client = client_with()

    def test_a_missing_java_is_a_503_with_its_own_code(self):
        with patch("app.shutil.which", return_value=None), \
                patch("app.xls2xform.xls2xform_convert") as convert:
            response = post(self.client, household_workbook())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["errorCode"], "validator-unavailable")
        self.assertIn("Java", response.json["error"])
        self.assertNotIn("flag", response.json["error"])  # no advice to bypass it
        convert.assert_not_called()

    def test_it_does_not_look_like_an_invalid_spreadsheet(self):
        with patch("app.shutil.which", return_value=None):
            response = post(self.client, household_workbook())
        self.assertNotEqual(response.status_code, 400)
        self.assertNotEqual(response.json["errorCode"], "invalid-xlsform")

    def test_pyxforms_own_java_error_is_recognised_if_the_precheck_disagrees(self):
        with patch("app.java_status", return_value={"available": True, "path": "/x/java", "version": "x"}), \
                patch("app.xls2xform.xls2xform_convert", side_effect=OSError(JAVA_MESSAGE)):
            response = post(self.client, household_workbook())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["errorCode"], "validator-unavailable")

    def test_readiness_reports_the_missing_dependency_while_liveness_stays_up(self):
        with patch("app.shutil.which", return_value=None):
            ready = self.client.get("/readyz")
            live = self.client.get("/healthz")
        self.assertEqual(ready.status_code, 503)
        self.assertEqual(ready.json["status"], "unavailable")
        self.assertFalse(ready.json["java"]["available"])
        self.assertFalse(ready.json["validated"])
        self.assertEqual(live.status_code, 200)  # the entrypoint polls this while booting

    def test_readiness_is_ok_when_java_resolves(self):
        with patch("app.shutil.which", return_value="/usr/bin/java"), \
                patch("app._java_version", return_value="openjdk version \"17\""):
            ready = self.client.get("/readyz")
        self.assertEqual(ready.status_code, 200)
        self.assertTrue(ready.json["validated"])
        self.assertEqual(ready.json["java"]["version"], "openjdk version \"17\"")

    def test_other_failures_are_still_reported_normally(self):
        with patch("app.java_status", return_value={"available": True, "path": "/x/java", "version": "x"}), \
                patch("app.xls2xform.xls2xform_convert", side_effect=OSError("disk full")):
            response = post(self.client, household_workbook())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["errorCode"], "compile-failed")


class SkipValidationPolicyTest(unittest.TestCase):
    """Skipping is possible only when asked for AND permitted, and is never silent."""

    def setUp(self):
        reset_java_cache()
        self.addCleanup(reset_java_cache)

    @staticmethod
    def fake_convert(**kwargs):
        from pathlib import Path
        Path(kwargs["xform_path"]).write_text("<h:html/>", encoding="utf-8")
        return []

    def convert_with(self, env):
        client = client_with(env)
        with patch("app.shutil.which", return_value=None), \
                patch("app.xls2xform.xls2xform_convert", side_effect=self.fake_convert) as convert:
            response = post(client, household_workbook())
        return client, response, convert

    def test_validation_is_on_by_default(self):
        with patch.dict(os.environ, {}):
            for var in POLICY_VARS:
                os.environ.pop(var, None)
            self.assertEqual(compiler.validation_policy(), ("strict", None))

    def test_asking_to_skip_without_permission_is_refused(self):
        client, response, convert = self.convert_with({"FORM_COMPILER_SKIP_VALIDATE": "true"})
        self.assertEqual(response.status_code, 503)  # still strict, and Java is hidden
        convert.assert_not_called()
        with patch.dict(os.environ, {"FORM_COMPILER_SKIP_VALIDATE": "true"}):
            os.environ.pop("FORM_COMPILER_PERMIT_SKIP_VALIDATE", None)
            mode, refusal = compiler.validation_policy()
        self.assertEqual(mode, "strict")
        self.assertIn("FORM_COMPILER_PERMIT_SKIP_VALIDATE", refusal)

    def test_permission_alone_does_not_skip(self):
        client, response, convert = self.convert_with({"FORM_COMPILER_PERMIT_SKIP_VALIDATE": "true"})
        self.assertEqual(response.status_code, 503)
        convert.assert_not_called()

    def test_both_settings_skip_validation_and_say_so_in_every_response(self):
        env = {"FORM_COMPILER_SKIP_VALIDATE": "true", "FORM_COMPILER_PERMIT_SKIP_VALIDATE": "true"}
        client, response, convert = self.convert_with(env)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertIs(convert.call_args.kwargs["validate"], False)
        self.assertIn(compiler.SKIP_WARNING, response.json["warnings"])
        self.assertIn("NOT been checked", compiler.SKIP_WARNING)

    def test_readiness_names_the_unvalidated_mode(self):
        env = {"FORM_COMPILER_SKIP_VALIDATE": "true", "FORM_COMPILER_PERMIT_SKIP_VALIDATE": "true"}
        ready = client_with(env).get("/readyz")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json["status"], "ok-unvalidated")
        self.assertFalse(ready.json["validated"])

    def test_strict_mode_always_passes_validate_true(self):
        reset_java_cache()
        with patch("app.shutil.which", return_value="/usr/bin/java"), \
                patch("app.xls2xform.xls2xform_convert", side_effect=self.fake_convert) as convert:
            response = post(client_with(), household_workbook())
        self.assertEqual(response.status_code, 200)
        self.assertIs(convert.call_args.kwargs["validate"], True)
        self.assertNotIn(compiler.SKIP_WARNING, response.json["warnings"] or [])


class WarningFilterTest(unittest.TestCase):
    def test_jvm_notices_are_dropped_and_real_warnings_kept(self):
        cleaned = compiler._clean_warnings([
            "ODK Validate Warnings:\nPicked up JAVA_TOOL_OPTIONS: -Dx=1\n",
            "A real warning about the form",
            "ODK Validate Warnings:\nPicked up _JAVA_OPTIONS: -Xmx1g\nsomething useful\n",
        ])
        self.assertEqual(cleaned, ["A real warning about the form", "ODK Validate Warnings:\nsomething useful"])

    def test_nothing_in_nothing_out(self):
        self.assertEqual(compiler._clean_warnings(None), [])
        self.assertEqual(compiler._clean_warnings([]), [])


if __name__ == "__main__":
    unittest.main()
