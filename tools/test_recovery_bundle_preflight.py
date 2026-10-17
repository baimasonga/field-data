"""No Docker required: recovery archive preflight regression tests."""
import importlib.util
import io
from pathlib import Path
import unittest
import warnings
import zipfile

SCRIPT = Path(__file__).with_name("verify-recovery-bundle.py")
spec = importlib.util.spec_from_file_location("recovery_verifier", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class RecoveryArchivePreflightTests(unittest.TestCase):
    @staticmethod
    def members(paths):
        stream = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(stream, "w") as archive:
                for filename in paths:
                    archive.writestr(filename, b"fixture")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            return archive.infolist()

    def test_normal_archive(self):
        verifier.validate_archive_members(self.members(["manifest.json", "files/0.bin"]))

    def test_duplicate_manifest_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate ZIP"):
            verifier.validate_archive_members(self.members(["manifest.json", "manifest.json"]))

    def test_duplicate_payload_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate ZIP"):
            verifier.validate_archive_members(self.members(["manifest.json", "files/0.bin", "files/0.bin"]))

    def test_directory_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unexpected directory"):
            verifier.validate_archive_members(self.members(["manifest.json", "files/"]))

    def test_size_bound_rejected(self):
        member = zipfile.ZipInfo("oversized.bin")
        member.file_size = 9 * 1024**3
        with self.assertRaisesRegex(ValueError, "limits"):
            verifier.validate_archive_members([member])


if __name__ == "__main__":
    unittest.main()
