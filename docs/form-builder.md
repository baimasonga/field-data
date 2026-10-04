# Building a Form in the browser

**Data Collection → Form Builder → select a project → Open Advanced Form Builder.**

The existing **Project → Forms → Create Form → Build a Form** path also works. Add questions, press Create
Form, and the Form appears as a draft exactly as an uploaded spreadsheet would.
Publish it and a phone running ODK Collect downloads it from the same list as
any other Form.

## What it actually does

The builder does not create the Form. It asks the server to write an XLSForm
from what you have built, then posts that spreadsheet to the ordinary Form
upload endpoint. So pyxform's validation, drafts and publishing, versioning and
the OpenRosa list ODK Collect reads are all the existing ones — there is one
path by which a Form comes into being, and the builder is a way of reaching it
rather than a second one beside it.

That also means the spreadsheet is real. **Download as XLSForm** gives you the
file at any point.

## What it covers

Text, whole number, decimal number, date, time, date and time, choose one,
choose several, note, location and photo. Per question: a label, a name, a
hint, and whether an answer is required. Choice questions carry their own list
of choices.

Names are suggested from labels — "How many rooms?" becomes `how_many_rooms` —
and can be overwritten. They become XML element names, so they must start with
a letter or underscore and use only letters, digits, underscores, dots and
hyphens, must not repeat, and must not be one of the names ODK reserves
(`instanceID`, `meta`, `today`, `deviceid` and the rest). The builder refuses
all of that before a spreadsheet is written, because pyxform's version of the
same complaint is about a file you never saw.

## Advanced authoring

Advanced authoring supports nested groups and repeats, repeat counts, calculations, conditional relevance and required answers, constraints and their messages, reusable choice lists, cascading choice filters, and translated labels and hints. Expressions use XLSForm syntax such as `${age} >= 18`. Dependency references identify missing fields and link to the corresponding question. Validate with compiler checks the actual generated XLSForm and links field diagnostics before creation.

Definitions persist locally while editing and are saved alongside created forms for reopening. Import XLSForm converts supported spreadsheets into editable definitions, preserving extra columns and supplementary sheets. Reopening a form without a saved definition attempts import from its stored XLSForm. Unsupported constructs, formulas and rich text retain the original spreadsheet workflow. Visual controls support reusable choices, language labels/hints, cascade attributes, conditions and arithmetic. External CSV lookups and file-based selects use ordinary draft attachments; entity creation/update declarations and property mappings compile through PyXForm. Choose Save as a new draft of this existing form ID to update a reopened form without publishing it.

A Form built here can be reopened and edited: the builder's own definition is
kept beside the Form. A Form uploaded as a spreadsheet can be imported from its stored XLSForm; unsupported constructs retain the original spreadsheet workflow.

## How it has been checked

`central/server/test/xlsform/roundtrip.js` runs the whole pipeline — builder
definition to XLSForm to pyxform to XForm to ODK's own field parser — and
checks the fields that come out are the questions that went in, with the right
types, with `select_multiple` flagged and a photo marked binary. It needs
pyxform at the version the container pins; the file says how.

Beyond that, on 2026-09-20: a Form was built in a browser against a real
server with the real form-compiler running, created, published, and found in
the OpenRosa form list with its id, name, version and download URL — which is
what a phone reads.

The browser acceptance fixture is compiled by real PyXForm. Tests verify invalid repeated ages block submission, calculated relevance reveals the adult question, and the sent XML contains both calculated values and answers. Builder discovery and missing project permissions also have browser checks.
