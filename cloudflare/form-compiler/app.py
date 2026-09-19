"""Internal XLSForm compiler with the HTTP contract expected by ODK Central."""

import logging
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from flask import Flask, jsonify, request
from pyxform import xls2xform
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
            except Exception as exc:  # PyXForm exposes user-facing validation errors as exceptions.
                LOG.exception("XLSForm conversion failed")
                return _response(error=str(exc))

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_error):
        return _response(status=413, error="The XLSForm exceeds the configured upload limit.")

    return app


application = create_app()
