import unittest
from unittest.mock import patch

from app import _merge_duplicate_meta, create_app


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


class DuplicateMetaTest(unittest.TestCase):
    """A form with two <meta> blocks is accepted by the server and then cannot
    be opened, so the compiler folds them together before that can happen."""

    MODEL = (
        '<h:html><h:head><model>'
        '<instance><data id="x">{body}</data></instance>'
        '<instance id="choices"><root><meta><a/></meta><meta><b/></meta></root></instance>'
        '<bind nodeset="/data/name"/>'
        '</model></h:head></h:html>'
    )

    def merge(self, body):
        return _merge_duplicate_meta(self.MODEL.format(body=body))

    def test_two_meta_blocks_become_one_keeping_every_child(self):
        xform, warning = self.merge(
            '<meta><instanceID/></meta><name/><meta><audit/></meta>')
        self.assertIn('<meta><instanceID/><audit/></meta>', xform)
        self.assertIn('<name/>', xform)
        self.assertEqual(xform.count('<meta>'), 3)  # one here, two left alone below
        self.assertIsNotNone(warning)
        self.assertIn('merged into one', warning)

    def test_a_single_meta_block_is_left_exactly_as_it_was(self):
        original = self.MODEL.format(body='<meta><instanceID/></meta><name/>')
        xform, warning = _merge_duplicate_meta(original)
        self.assertEqual(xform, original)
        self.assertIsNone(warning)

    def test_meta_and_orx_meta_are_different_elements_and_stay_apart(self):
        # The engine keys children by node name, so these never collide and
        # merging them would change what the form means.
        xform, warning = self.merge(
            '<meta><instanceID/></meta><orx:meta><audit/></orx:meta>')
        self.assertIn('<meta><instanceID/></meta>', xform)
        self.assertIn('<orx:meta><audit/></orx:meta>', xform)
        self.assertIsNone(warning)

    def test_a_prefixed_duplicate_is_merged_under_its_own_name(self):
        xform, warning = self.merge(
            '<orx:meta><instanceID/></orx:meta><orx:meta><audit/></orx:meta>')
        self.assertIn('<orx:meta><instanceID/><audit/></orx:meta>', xform)
        self.assertIsNotNone(warning)

    def test_attributes_on_the_surviving_block_are_kept(self):
        xform, _ = self.merge(
            '<meta xmlns:o="u"><instanceID/></meta><meta><audit/></meta>')
        self.assertIn('<meta xmlns:o="u"><instanceID/><audit/></meta>', xform)

    def test_a_secondary_instance_is_none_of_our_business(self):
        # The choices instance in MODEL has two <meta> children on purpose.
        xform, warning = self.merge('<meta><instanceID/></meta>')
        self.assertIn('<root><meta><a/></meta><meta><b/></meta></root>', xform)
        self.assertIsNone(warning)
