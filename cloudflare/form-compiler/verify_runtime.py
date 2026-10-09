"""Prove that this runtime can really validate and compile an XLSForm.

Run it inside the image that will serve traffic, not in a development shell:

    python verify_runtime.py

It fails the build or deployment if Java is missing from PATH, if ODK Validate
cannot run, or if a valid spreadsheet does not compile into an XForm carrying the
skip logic, constraint, repeat group and GPS field it was written with. It also
confirms that an invalid spreadsheet is rejected by the validator rather than
waved through, because "everything compiles" is exactly what a disabled
validator looks like.
"""

import subprocess
import sys

from app import application, java_status, validation_policy
from xlsform_fixtures import household_workbook, undefined_reference_workbook


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def post(client, data):
    return client.post("/api/v1/convert", data=data, headers={"X-XlsForm-FormId-Fallback": "verify"})


def main():
    mode, refusal = validation_policy()
    if refusal:
        fail(refusal)
    if mode != "strict":
        fail("validation is configured to be skipped; a runtime check must run with it enabled")

    java = java_status(max_age=0)
    if not java["available"]:
        fail("`java` is not on PATH for the compiler process")
    # Ask the JVM directly as well, so a broken install is not mistaken for a working one.
    completed = subprocess.run(["java", "-version"], capture_output=True, text=True, timeout=30)
    if completed.returncode != 0:
        fail(f"`java -version` exited {completed.returncode}: {completed.stderr.strip()}")
    print(f"java: {java['path']}")
    print(f"version: {java['version']}")

    client = application.test_client()

    ready = client.get("/readyz")
    if ready.status_code != 200 or ready.json.get("validated") is not True:
        fail(f"/readyz is not ready: {ready.status_code} {ready.json}")

    good = post(client, household_workbook())
    if good.status_code != 200:
        fail(f"a valid XLSForm did not compile: {good.status_code} {good.json}")
    xform = good.json["result"]
    for needle, what in (
        ("relevant=", "skip logic"),
        ("constraint=", "a constraint"),
        ("jr:template", "a repeat group"),
        ('type="geopoint"', "a GPS field"),
    ):
        if needle not in xform:
            fail(f"the compiled XForm lost {what} (missing {needle!r})")

    bad = post(client, undefined_reference_workbook())
    if bad.status_code != 400 or bad.json.get("errorCode") != "invalid-xlsform":
        fail(f"an invalid XLSForm was not rejected as invalid: {bad.status_code} {bad.json}")

    print("ok: valid XLSForm compiled with skip logic, constraint, repeat and GPS; invalid XLSForm rejected")


if __name__ == "__main__":
    main()
