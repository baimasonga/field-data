# Field Data Form Compiler

This private, loopback-only component converts XLSForm workbooks into the ODK
XForm format consumed by Field Data. It is built into the same Cloudflare
Container as the application and implements Central's existing
`POST /api/v1/convert` contract.

The conversion engine is the maintained, BSD-licensed `pyxform` package. The
Field Data component owns the HTTP boundary, limits request size, isolates each
conversion in a temporary directory, exposes `/healthz`, and is supervised by
the container entrypoint.

Run its contract tests with Python 3.12:

```bash
python -m pip install -r requirements.txt
python -m unittest -v test_app.py
```

## Validation and Java

`pyxform` validates every XForm it produces with **ODK Validate, a Java program**,
and finds it by looking up `java` on the compiler process's `PATH` (it ignores
`JAVA_HOME`). The runtime image therefore installs `openjdk-17-jre-headless`.
Without Java no XLSForm can be compiled, and that is reported as a server fault,
never as a problem with the uploaded file.

Endpoints:

| Path | Meaning |
| --- | --- |
| `GET /healthz` | Liveness only. Cheap; the entrypoint polls it while booting. |
| `GET /readyz` | `200` with `validated: true` when forms can really be validated. `503` when Java is missing, will not start (`java -version` fails, for example from an invalid `JAVA_TOOL_OPTIONS`) or is older than 8. `200` with `validated: false` and status `ok-unvalidated` when validation is deliberately skipped. Central's status probe (`systemStatus.pyxform`) and the deploy gate require `validated: true`, so neither of the last two counts as healthy. |
| `POST /api/v1/convert` | The Central contract. |

`/api/v1/convert` answers with a stable `errorCode` alongside the existing fields:

| `errorCode` | HTTP | Meaning | Central responds with |
| --- | --- | --- | --- |
| `validator-unavailable` | 503 | Java or ODK Validate cannot run. A deployment fault. | `502.4`, "your file was not rejected" |
| `invalid-xlsform` | 400 | The spreadsheet is wrong and its author can fix it. | `400.15`, `details.kind = invalid-xlsform` |
| `compile-failed` | 400 | The spreadsheet converted but the generated XForm was rejected. | `400.15`, `details.kind = compile-failed` |

### Skipping validation (not for production)

Validation is always on. It can be skipped only when **both** are set, which makes
turning it off a deliberate act in each environment that allows it:

| Variable | Purpose |
| --- | --- |
| `FORM_COMPILER_SKIP_VALIDATE=true` | Ask for `pyxform --skip_validate` behaviour. |
| `FORM_COMPILER_PERMIT_SKIP_VALIDATE=true` | Permit it. Set only in development or test environments. |

Asking without permission is ignored and logged as an error. Missing Java never
switches validation off by itself. When skipping is active, every response carries
a warning that the XForm was **not** checked, and `/readyz` reports
`ok-unvalidated`. Production must set neither variable.

### Verifying a runtime

Run this inside the image that serves traffic. It fails if Java is not on `PATH`,
if ODK Validate cannot run, if a valid form (skip logic, constraint, repeat group,
GPS) does not compile, or if an invalid form is accepted:

```bash
docker run --rm --entrypoint java IMAGE -version
docker run --rm -w /opt/field-data-form-compiler --entrypoint sh IMAGE -c './venv/bin/python verify_runtime.py'
```

The image build runs `verify_runtime.py`, so an image without a working validator
cannot be built.

Tests (`REQUIRE_JAVA=1` turns a missing JVM into a failure instead of a skip):

```bash
REQUIRE_JAVA=1 python -m unittest -v test_app.py test_data_exports.py test_xlsform_pipeline.py
```

