"""Internal XLSForm compiler with the HTTP contract expected by ODK Central."""

import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from flask import Flask, jsonify, request
from pyxform import xls2xform
from pyxform.errors import PyXFormError
from pyxform.validators.odk_validate import ODKValidateError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename


LOG = logging.getLogger(__name__)
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024



# A form whose primary instance carries two <meta> elements is accepted by the
# server and then refuses to open: the Web Forms engine raises "multiple
# elements for non-repeat nodeset: /data/meta" and the person filling it in
# sees only that. It happens when an XLSForm declares its own meta group and
# the converter adds the one it always adds, so the author gets two where they
# meant one, and nothing tells them until somebody tries to fill the form in.
#
# Two <meta> siblings are never what anyone intended, so merge them: the
# children of the later ones move into the first, in order, and the empties go.
# The alternative is shipping a form that cannot be opened.
#
# This is deliberately narrow. Only <meta> is merged, only directly under the
# primary instance root, and only exact duplicates of the same element name --
# <meta> and <orx:meta> are different elements to the engine and are left
# alone. Anything else is the author's structure and not ours to rewrite.
META_PATTERN = re.compile(
    r'<(?P<name>(?:[A-Za-z_][\w.-]*:)?meta)(?P<attrs>\s[^>]*?)?>'
    r'(?P<body>.*?)'
    r'</(?P=name)\s*>',
    re.DOTALL,
)


# The primary instance is the first <instance> in the model. Secondary
# instances hold choice lists and external data, and whatever is in those is
# not this function's business.
PRIMARY_INSTANCE_PATTERN = re.compile(
    r'<(?P<name>(?:[A-Za-z_][\w.-]*:)?instance)(?:\s[^>]*)?>.*?</(?P=name)\s*>',
    re.DOTALL,
)


# ---------------------------------------------------------------------------
# Validation policy
#
# pyxform validates every generated XForm with ODK Validate, which is a Java
# program. A runtime without Java therefore cannot compile anything, and that
# is a deployment fault, not a fault in the spreadsheet. Three rules follow:
#
#   1. Validation is on by default and is never switched off implicitly. A
#      missing Java is reported as "validator unavailable", not worked around.
#   2. Skipping validation needs two explicit settings, one to ask for it
#      (FORM_COMPILER_SKIP_VALIDATE) and one, set only in environments where
#      that is acceptable, to permit it (FORM_COMPILER_PERMIT_SKIP_VALIDATE).
#      Asking without permission is refused and logged. Production sets neither.
#   3. When validation is skipped it is never silent: every response carries a
#      warning saying so, and /readyz reports it.
# ---------------------------------------------------------------------------

STRICT = "strict"
SKIP = "skip"

# Stable machine-readable reasons, consumed by Central and shown by the browser.
VALIDATOR_UNAVAILABLE = "validator-unavailable"
INVALID_XLSFORM = "invalid-xlsform"
COMPILE_FAILED = "compile-failed"

SKIP_WARNING = (
    "Validation was skipped because this server is configured to allow that. "
    "This XForm has NOT been checked by ODK Validate and may fail when it is "
    "opened or submitted to."
)

# JVM start-up notices that a deployment may inject (JAVA_TOOL_OPTIONS) arrive
# on stderr, which pyxform reports as "validation warnings". They are not about
# the form, so they are not shown to the person who uploaded it.
_JVM_NOISE = re.compile(r"^(Picked up (JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS)\b.*)$")
_EMPTY_VALIDATE_HEADER = re.compile(r"^\s*ODK Validate Warnings:\s*$")


def _truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def validation_policy():
    """Return (mode, refusal). `refusal` explains a skip request that was ignored."""
    requested = _truthy(os.environ.get("FORM_COMPILER_SKIP_VALIDATE"))
    permitted = _truthy(os.environ.get("FORM_COMPILER_PERMIT_SKIP_VALIDATE"))
    if requested and permitted:
        return SKIP, None
    if requested:
        return STRICT, (
            "FORM_COMPILER_SKIP_VALIDATE is set but FORM_COMPILER_PERMIT_SKIP_VALIDATE "
            "is not, so validation stays on."
        )
    return STRICT, None


def _java_version(java):
    try:
        result = subprocess.run(
            [java, "-version"], capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    lines = [line for line in (result.stderr or result.stdout or "").splitlines()
             if line.strip() and not _JVM_NOISE.match(line.strip())]
    return lines[0].strip() if lines else None


_java_cache = {"at": 0.0, "value": None}


def java_status(max_age=30.0):
    """Whether `java` resolves on the PATH the converter will actually use.

    pyxform looks the executable up with shutil.which and ignores JAVA_HOME, so
    this asks the same question it will. The answer is cached briefly because
    readiness probes arrive often and starting a JVM is not free.
    """
    now = time.monotonic()
    cached = _java_cache["value"]
    if cached is not None and now - _java_cache["at"] < max_age:
        return cached
    path = shutil.which("java")
    value = {"available": path is not None, "path": path,
             "version": _java_version(path) if path else None}
    _java_cache.update(at=now, value=value)
    return value


def _clean_warnings(warnings):
    cleaned = []
    for warning in warnings or []:
        lines = [line for line in str(warning).splitlines() if not _JVM_NOISE.match(line.strip())]
        text = "\n".join(lines).strip()
        if text and not _EMPTY_VALIDATE_HEADER.match(text):
            cleaned.append(text)
    return cleaned


def _merge_duplicate_meta(xform):
    """Fold repeated <meta> siblings in the primary instance into the first.

    Returns the XForm and a warning naming what was merged, or None.
    """
    primary = PRIMARY_INSTANCE_PATTERN.search(xform)
    if primary is None:
        return xform, None

    # Work inside the primary instance only, then put it back where it was.
    scoped = primary.group(0)
    merged, warning = _merge_within(scoped)
    if warning is None:
        return xform, None
    return xform[:primary.start()] + merged + xform[primary.end():], warning


def _merge_within(xform):
    matches = list(META_PATTERN.finditer(xform))
    if len(matches) < 2:
        return xform, None

    by_name = {}
    for match in matches:
        by_name.setdefault(match.group("name"), []).append(match)

    merged_names = []
    # Rebuild from the end so earlier offsets stay valid.
    replacements = []
    for name, group in by_name.items():
        if len(group) < 2:
            continue
        merged_names.append(name)
        first = group[0]
        bodies = "".join(match.group("body") for match in group)
        attrs = first.group("attrs") or ""
        replacements.append((first.start(), first.end(),
                             f"<{name}{attrs}>{bodies}</{name}>"))
        for match in group[1:]:
            replacements.append((match.start(), match.end(), ""))

    if not merged_names:
        return xform, None

    for start, end, text in sorted(replacements, reverse=True):
        xform = xform[:start] + text + xform[end:]

    names = ", ".join(sorted(merged_names))
    return xform, (
        f"This form declared more than one <{names}> block. They have been "
        "merged into one, because a form with two would be accepted here and "
        "then fail to open. Remove the extra meta group from your XLSForm to "
        "silence this."
    )


def _response(status=400, result=None, itemsets=None, warnings=None, error=None, error_code=None):
    # `errorCode` is additive: older callers read only status/result/error.
    return jsonify(
        status=status,
        result=result,
        itemsets=itemsets,
        warnings=warnings,
        error=error,
        errorCode=error_code,
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

    mode, refusal = validation_policy()
    if refusal is not None:
        LOG.error("%s", refusal)
    if mode == SKIP:
        LOG.warning("XForm validation is DISABLED by configuration; forms are not checked by ODK Validate.")

    @app.get("/healthz")
    def health():
        # Liveness only: the entrypoint polls this every second while booting,
        # so it must not start a JVM. Readiness is /readyz.
        return jsonify(status="ok", component="field-data-form-compiler", validation=mode)

    @app.get("/readyz")
    def ready():
        java = java_status()
        body = {"component": "field-data-form-compiler", "validation": mode,
                "java": java, "skipRefused": refusal}
        if mode == SKIP:
            return jsonify(status="ok-unvalidated", validated=False, **body)
        if not java["available"]:
            return jsonify(status="unavailable", validated=False,
                           reason="Java (8+) is required for XForm validation and was not found on PATH.",
                           **body), 503
        return jsonify(status="ok", validated=True, **body)

    @app.post("/api/v1/convert")
    def convert():
        data = request.get_data(cache=False)
        if not data:
            return _response(error="The XLSForm request body is empty.")

        form_id = _fallback_name(request.headers.get("X-XlsForm-FormId-Fallback"))
        extension = ".xlsx" if _is_xlsx(data) else ".xls"
        validate = mode != SKIP

        # Answer a missing validator before doing any work. This is a fault in
        # the deployment, so it is a 503 with its own code and not a 400 that
        # reads as though the spreadsheet were wrong.
        if validate and not java_status()["available"]:
            LOG.error("Java is not available on PATH; XLSForm validation cannot run.")
            return _response(
                status=503, error_code=VALIDATOR_UNAVAILABLE,
                error="Form validation is unavailable because Java (8+) is not installed on this server.")

        with TemporaryDirectory(prefix="field-data-form-") as directory:
            source = Path(directory, f"{form_id}{extension}")
            target = Path(directory, f"{form_id}.xml")
            source.write_bytes(data)

            try:
                warnings = _clean_warnings(xls2xform.xls2xform_convert(
                    xlsform_path=str(source),
                    xform_path=str(target),
                    validate=validate,
                    pretty_print=False,
                ))
                if not validate:
                    warnings = [SKIP_WARNING, *warnings]
                if warnings:
                    LOG.warning("XLSForm conversion warning: %s", warnings)
                if not target.is_file():
                    return _response(error=warnings or "The compiler did not produce an XForm.",
                                     error_code=COMPILE_FAILED)

                xform, merge_warning = _merge_duplicate_meta(
                    target.read_text(encoding="utf-8"))
                if merge_warning is not None:
                    LOG.warning("%s", merge_warning)
                    warnings = [*(warnings or []), merge_warning]

                itemsets = Path(directory, "itemsets.csv")
                return _response(
                    status=200,
                    result=xform,
                    itemsets=itemsets.read_text(encoding="utf-8") if itemsets.is_file() else None,
                    warnings=warnings,
                )
            except OSError as exc:
                # pyxform raises OSError when it cannot find Java. Should the
                # pre-check above ever disagree with it, it is still the same fault.
                if "Java" in str(exc):
                    LOG.exception("XLSForm validation unavailable")
                    return _response(status=503, error_code=VALIDATOR_UNAVAILABLE,
                                     error="Form validation is unavailable because Java (8+) is not installed on this server.")
                LOG.exception("XLSForm conversion failed")
                return _response(error=str(exc), error_code=COMPILE_FAILED)
            except ODKValidateError as exc:
                # The spreadsheet converted, but the XForm it produced was rejected.
                LOG.warning("ODK Validate rejected the generated XForm: %s", exc)
                return _response(error=str(exc), error_code=COMPILE_FAILED)
            except PyXFormError as exc:
                # The content of the spreadsheet is wrong, and the author can fix it.
                LOG.warning("Invalid XLSForm: %s", exc)
                return _response(error=str(exc), error_code=INVALID_XLSFORM)
            except Exception as exc:  # PyXForm exposes user-facing validation errors as exceptions.
                LOG.exception("XLSForm conversion failed")
                return _response(error=str(exc), error_code=COMPILE_FAILED)

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_error):
        return _response(status=413, error="The XLSForm exceeds the configured upload limit.")


    @app.post('/api/v1/data-export/<fmt>')
    def data_export(fmt):
        # Internal-only listener. Central validates source permissions before calling.
        from data_exports import write_export
        from flask import Response
        try:
            payload = request.get_json()
            if not isinstance(payload, dict) or len(payload.get('rows', [])) > 5000:
                return jsonify(message='Export is limited to 5000 submissions.'), 400
            content, mime, extension = write_export(payload, fmt)
            return Response(content, mimetype=mime, headers={'Content-Disposition': f'attachment; filename="analysis.{extension}"'})
        except (ValueError, KeyError, TypeError) as error:
            return jsonify(message=str(error)), 400

    return app


application = create_app()
