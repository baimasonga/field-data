"""Internal XLSForm compiler with the HTTP contract expected by ODK Central."""

import logging
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from flask import Flask, jsonify, request
from pyxform import xls2xform
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename


LOG = logging.getLogger(__name__)
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _response(status=400, result=None, itemsets=None, warnings=None, error=None):
    return jsonify(
        status=status,
        result=result,
        itemsets=itemsets,
        warnings=warnings,
        error=error,
    ), status


def _fallback_name(value):
    candidate = secure_filename(value or "")
    return candidate or str(uuid4())


def _is_xlsx(data):
    return len(data) > 3 and data[:2] == b"PK" and data[2:4] in (b"\x03\x04", b"\x05\x06", b"\x07\x08")


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = int(
        os.environ.get("FORM_COMPILER_MAX_BYTES", DEFAULT_MAX_UPLOAD_BYTES)
    )

    @app.get("/healthz")
    def health():
        return jsonify(status="ok", component="field-data-form-compiler")

    @app.post("/api/v1/convert")
    def convert():
        data = request.get_data(cache=False)
        if not data:
            return _response(error="The XLSForm request body is empty.")

        form_id = _fallback_name(request.headers.get("X-XlsForm-FormId-Fallback"))
        extension = ".xlsx" if _is_xlsx(data) else ".xls"

        with TemporaryDirectory(prefix="field-data-form-") as directory:
            source = Path(directory, f"{form_id}{extension}")
            target = Path(directory, f"{form_id}.xml")
            source.write_bytes(data)

            try:
                warnings = xls2xform.xls2xform_convert(
                    xlsform_path=str(source),
                    xform_path=str(target),
                    validate=True,
                    pretty_print=False,
                )
                if warnings:
                    LOG.warning("XLSForm conversion warning: %s", warnings)
                if not target.is_file():
                    return _response(error=warnings or "The compiler did not produce an XForm.")

                itemsets = Path(directory, "itemsets.csv")
                return _response(
                    status=200,
                    result=target.read_text(encoding="utf-8"),
                    itemsets=itemsets.read_text(encoding="utf-8") if itemsets.is_file() else None,
                    warnings=warnings,
                )
            except Exception as exc:  # PyXForm exposes user-facing validation errors as exceptions.
                LOG.exception("XLSForm conversion failed")
                return _response(error=str(exc))

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_error):
        return _response(status=413, error="The XLSForm exceeds the configured upload limit.")

    return app


application = create_app()
