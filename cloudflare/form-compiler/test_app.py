import unittest
from unittest.mock import patch

from app import create_app


class FormCompilerContractTest(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def test_health(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["component"], "field-data-form-compiler")

    def test_empty_upload_uses_central_error_contract(self):
        response = self.client.post("/api/v1/convert", data=b"")
        self.assertEqual(response.status_code, 400)
        self.assertIn("empty", response.json["error"])
        self.assertEqual(response.json["status"], 400)

    @patch("app.xls2xform.xls2xform_convert")
    def test_conversion_returns_xform_itemsets_and_warnings(self, convert):
        def write_outputs(*, xform_path, **_kwargs):
            from pathlib import Path
            Path(xform_path).write_text("<h:html/>", encoding="utf-8")
            Path(xform_path).with_name("itemsets.csv").write_text("list_name,name\n", encoding="utf-8")
            return ["fixture warning"]

        convert.side_effect = write_outputs
        response = self.client.post(
            "/api/v1/convert",
            data=b"PK\x03\x04fixture",
            headers={"X-XlsForm-FormId-Fallback": "../../unsafe name"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["result"], "<h:html/>")
        self.assertEqual(response.json["itemsets"], "list_name,name\n")
        self.assertEqual(response.json["warnings"], ["fixture warning"])
        source_path = convert.call_args.kwargs["xlsform_path"]
        self.assertTrue(source_path.endswith("unsafe_name.xlsx"))


if __name__ == "__main__":
    unittest.main()
