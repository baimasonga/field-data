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
